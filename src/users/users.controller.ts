import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import {
  OneUserDto,
  ParameterDto,
  SaveScoreDto,
  StudentDto,
  UserDto,
} from 'src/validators/user.dto';
import { PayedDto } from 'src/validators/shop.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly userService: UsersService) {}

  @Post('/api/save-user')
  saveUserData(@Body() body: UserDto) {
    return this.userService.saveUserData(body);
  }

  @Post('/api/verify-code')
  checkUserCode(@Body() body: UserDto) {
    return this.userService.checkUserCode(body.email, body.code);
  }

  @Post('/api/find-one-user')
  findOneUser(@Body() body: UserDto) {
    return this.userService.findUserById(body.id);
  }

  @Get('/api/find-all-users')
  findAllUsers() {
    return this.userService.findAll();
  }

  @Post('/api/find-by-name')
  findByName(@Body() body: UserDto) {
    return this.userService.findUserByName(body.name);
  }

  @Post('/api/save-score')
  saveUserScore(@Body() info: SaveScoreDto) {
    return this.userService.saveUserScore(info.id, info.score);
  }
  @Post('/api/login-admin')
  loginAdmin(@Body() password: string) {
    return this.userService.logInAdmin(password);
  }

  @Post('/api/update-code')
  updateUserCode(@Body() body: { id: number; code: string; attempt: number }) {
    return this.userService.updateUserCode(body.id, body.code, body.attempt);
  }

  @Delete('/api/delete-user')
  deleteUser(@Body() user: OneUserDto) {
    return this.userService.deleteUser(user.id);
  }

  @Post('/api/update-parameter')
  updateParam(@Body() body: ParameterDto) {
    return this.userService.updateParam(body.id, body.key, body.param);
  }
  @Get('/api/ping-server')
  pingServer() {
    return this.userService.pingServer();
  }
  @Post('/api/login-student')
  loginStudent(@Body() body: StudentDto) {
    return this.userService.logInStudent(body.email, body.code);
  }
  @Post('/api/update-after-pay/:id')
  updateParams(@Param('id') id: number, @Body() body: PayedDto) {
    return this.userService.updateUserItems(body, Number(id));
  }
}
