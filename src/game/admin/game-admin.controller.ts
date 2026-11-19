import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Length,
  Min,
  Max,
} from 'class-validator';
import type { Request } from 'express';
import { GameAccountsService } from '../accounts/game-accounts.service';
import { StoryEngine } from '../engines/story.engine';
import { GameGateway } from '../game.gateway';
import type { RoomControl } from '../game.gateway';
import type { TeamId } from '../game.types';
import {
  MAX_STORY_BYTES,
  parseStoryFile,
  validateStory,
} from '../story/story-document';
import { GameAdminService } from './game-admin.service';

type AdminRequest = Request & { gameModeratorId: string };
type StoryFile = { buffer: Buffer };

@Injectable()
export class GameModeratorGuard implements CanActivate {
  constructor(private readonly accounts: GameAccountsService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const session = await this.accounts.requireSession(
      /^Bearer ([^ ]+)$/.exec(req.headers.authorization ?? '')?.[1],
    );
    if (!session.moderator)
      throw new ForbiddenException('Game moderator access is required.');
    req.gameModeratorId = session.id;
    return true;
  }
}

class RoomCommandDto implements RoomControl {
  @IsIn([
    'start',
    'pause',
    'resume',
    'restart',
    'end',
    'room_hp',
    'capacity',
    'scene',
    'choice',
    'turn',
    'round',
    'enemy_hp',
    'victory',
    'defeat',
    'hp',
    'max_hp',
    'revive',
    'eliminate',
    'kick',
    'move_team',
  ])
  action!: string;

  @IsOptional()
  @IsUUID('4')
  playerId?: string;

  @IsOptional()
  @IsIn(['ravens', 'wolves', 'dragons', 'serpents'])
  teamId?: TeamId;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nodeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  choiceId?: string;

  @IsOptional()
  @IsInt()
  value?: number;
}

class AdjustmentDto {
  @IsUUID('4')
  requestId!: string;

  @IsIn(['credits', 'grant_gear', 'items'])
  action!: string;

  @IsOptional()
  @IsInt()
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  product?: string;

  @IsString()
  @MaxLength(300)
  reason!: string;
}

class ShopItemDto {
  @IsUUID('4')
  requestId!: string;
  @IsString()
  @Length(2, 60)
  name!: string;
  @IsIn(['heal', 'guard'])
  effect!: 'heal' | 'guard';
  @IsInt()
  @Min(1)
  @Max(320)
  power!: number;
  @IsInt()
  @Min(1)
  @Max(100000)
  price!: number;
}

class RevisionDto {
  @Matches(
    /^(seed|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/,
  )
  expectedRevision!: string;
}

const limits = {
  fileSize: MAX_STORY_BYTES,
  files: 1,
  fields: 1,
  fieldSize: 80,
  parts: 3,
};

@Controller('game/api/admin')
@UseGuards(GameModeratorGuard)
export class GameAdminController {
  private readonly logger = new Logger(GameAdminController.name);

  constructor(
    private readonly admin: GameAdminService,
    private readonly gateway: GameGateway,
    private readonly story: StoryEngine,
  ) {}

  @Get('rooms')
  @Header('Cache-Control', 'no-store')
  rooms() {
    return this.gateway.adminState();
  }

  @Post('rooms/:roomCode/commands')
  async command(
    @Param('roomCode') roomCode: string,
    @Body() command: RoomCommandDto,
    @Req() req: AdminRequest,
  ) {
    this.gateway.controlRoom(roomCode, command);
    await this.admin
      .log(req.gameModeratorId, command.action, roomCode, command)
      .catch(() =>
        this.logger.error(
          `Could not record ${command.action} for room ${roomCode}`,
        ),
      );
    return { applied: true };
  }

  @Get('story')
  @Header('Cache-Control', 'no-store')
  storyHistory() {
    return this.admin.storyHistory();
  }

  @Get('story/document')
  @Header('Cache-Control', 'no-store')
  document() {
    return {
      initialNodeId: this.story.getInitialNode().id,
      nodes: this.story.getStory(),
    };
  }

  @Post('story/preview')
  @UseInterceptors(FileInterceptor('file', { limits }))
  preview(@UploadedFile() file: StoryFile | undefined) {
    const { initialNodeId, nodes } = parseStoryFile(file?.buffer);
    return {
      initialNodeId,
      scenes: Object.values(nodes).map(({ id, title, choices }) => ({
        id,
        title,
        choiceCount: choices.length,
      })),
    };
  }

  @Post('story/publish')
  @UseInterceptors(FileInterceptor('file', { limits }))
  async publish(
    @UploadedFile() file: StoryFile | undefined,
    @Body() body: RevisionDto,
    @Req() req: AdminRequest,
  ) {
    const result = await this.admin.publish(
      req.gameModeratorId,
      parseStoryFile(file?.buffer),
      body.expectedRevision,
    );
    await this.story.onModuleInit();
    this.gateway.storyPublished();
    return result;
  }

  @Post('story/revisions/:revision/restore')
  async restore(
    @Param('revision', new ParseUUIDPipe({ version: '4' })) revision: string,
    @Body() body: RevisionDto,
    @Req() req: AdminRequest,
  ) {
    const document = validateStory(await this.admin.version(revision));
    const result = await this.admin.publish(
      req.gameModeratorId,
      document,
      body.expectedRevision,
      revision,
    );
    await this.story.onModuleInit();
    this.gateway.storyPublished();
    return result;
  }

  @Get('accounts')
  @Header('Cache-Control', 'no-store')
  accounts(@Query('search') search?: string) {
    return this.admin.accounts(typeof search === 'string' ? search : '');
  }

  @Post('accounts/:id/adjustments')
  async adjust(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: AdjustmentDto,
    @Req() req: AdminRequest,
  ) {
    await this.admin.adjust(req.gameModeratorId, id, body);
    this.gateway.refreshAccount(id);
    return { applied: true };
  }

  @Post('shop/items')
  createShopItem(@Body() body: ShopItemDto, @Req() req: AdminRequest) {
    return this.admin.createShopItem(req.gameModeratorId, body);
  }

  @Get('orders')
  @Header('Cache-Control', 'no-store')
  orders() {
    return this.admin.orders();
  }

  @Get('activity')
  @Header('Cache-Control', 'no-store')
  activity() {
    return this.admin.activity();
  }
}
