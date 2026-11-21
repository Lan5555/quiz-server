import { Injectable, OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { GameGear } from './entities/game_gear.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { GameGearDto } from './dto/game_gear.dto';
import { GEAR } from '../progression/catalog';
import { randomUUID } from 'node:crypto';

export const TryErrorResponse = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected gear error occurred';

  return {
    success: false,
    message,
    data: null,
  };
};

@Injectable()
export class GameGearService implements OnModuleInit {
  private readonly builtInGearIds = new Set(Object.keys(GEAR));

  constructor(
    @InjectRepository(GameGear)
    private readonly gameGearRepository: Repository<GameGear>,
  ) {}

  async onModuleInit() {
    await this.fetchAllGear();
  }

  private syncCatalogGear(gear: GameGear) {
    GEAR[gear.gearId] = {
      name: gear.name,
      slot: gear.slot as 'weapon' | 'armor',
      rarity: gear.rarity as 'common' | 'rare' | 'legendary',
      attack: gear.attack,
      armor: gear.armor,
      price: gear.price,
      paid: gear.paid,
      ...(gear.cashAmountMinor
        ? { cashAmountMinor: gear.cashAmountMinor }
        : {}),
      summonable: !gear.paid,
      createdAt: gear.created_at?.toISOString(),
      imageUrl:
        gear.imageUrl ||
        (gear.slot === 'armor'
          ? '/forge/shop/oathkeeper-plate.webp'
          : '/forge/shop/hollowfang.webp'),
    };
  }

  async createGear(gearValues: GameGearDto) {
    try {
      if (
        !gearValues.paid &&
        (!Number.isInteger(gearValues.price) || gearValues.price <= 0)
      ) {
        throw new Error('Cinder gear must have a price greater than zero.');
      }
      if (
        gearValues.paid &&
        (!gearValues.cashAmountMinor ||
          !Number.isInteger(gearValues.cashAmountMinor) ||
          gearValues.cashAmountMinor < 100)
      ) {
        throw new Error('Paid gear must have a valid cash price.');
      }
      if (Object.hasOwn(GEAR, gearValues.gearId)) {
        return {
          success: false,
          message: 'Gear ID is already reserved',
          data: null,
        };
      }

      const existing = await this.gameGearRepository.findOne({
        where: [{ gearId: gearValues.gearId }, { name: gearValues.name }],
      });
      if (existing) {
        return {
          success: false,
          message: 'Gear ID or name already exists',
          data: null,
        };
      }

      const gear = this.gameGearRepository.create({
        id: randomUUID(),
        ...gearValues,
        imageUrl:
          gearValues.imageUrl?.trim() ||
          (gearValues.slot === 'armor'
            ? '/forge/shop/oathkeeper-plate.webp'
            : '/forge/shop/hollowfang.webp'),
      });
      await this.gameGearRepository.save(gear);
      this.syncCatalogGear(gear);
      return {
        success: true,
        message: 'Gear created Successfully',
        data: gear,
      };
    } catch (error: unknown) {
      return {
        ...TryErrorResponse(error),
      };
    }
  }
  async fetchAllGear() {
    try {
      const gears = await this.gameGearRepository.find();
      for (const gear of gears) this.syncCatalogGear(gear);
      if (gears.length == 0) {
        return {
          success: false,
          message: 'No Gear Available',
          data: [],
        };
      }
      return {
        success: true,
        message: 'Fetched Gears Successfully',
        data: gears,
      };
    } catch (error: unknown) {
      return { ...TryErrorResponse(error) };
    }
  }
  async updateGear(id: string, gearValues: GameGearDto) {
    try {
      if (
        !gearValues.paid &&
        (!Number.isInteger(gearValues.price) || gearValues.price <= 0)
      ) {
        throw new Error('Cinder gear must have a price greater than zero.');
      }
      if (
        gearValues.paid &&
        (!gearValues.cashAmountMinor ||
          !Number.isInteger(gearValues.cashAmountMinor) ||
          gearValues.cashAmountMinor < 100)
      ) {
        throw new Error('Paid gear must have a valid cash price.');
      }
      const gear = await this.gameGearRepository.findOneBy({ id });
      if (!gear) {
        return {
          success: false,
          message: 'No gear found',
          data: null,
        };
      }
      if (
        gear.gearId !== gearValues.gearId &&
        this.builtInGearIds.has(gearValues.gearId)
      ) {
        return {
          success: false,
          message: 'Gear ID is already reserved',
          data: null,
        };
      }

      const duplicate = await this.gameGearRepository.findOne({
        where: [{ gearId: gearValues.gearId }, { name: gearValues.name }],
      });
      if (duplicate && duplicate.id !== gear.id) {
        return {
          success: false,
          message: 'Gear ID or name already exists',
          data: null,
        };
      }

      const oldGearId = gear.gearId;
      Object.assign(gear, gearValues);
      const savedGear = await this.gameGearRepository.save(gear);
      if (!this.builtInGearIds.has(oldGearId)) delete GEAR[oldGearId];
      this.syncCatalogGear(savedGear);
      return {
        success: true,
        message: 'Updated Gear Successfully',
        data: savedGear,
      };
    } catch (e) {
      return {
        ...TryErrorResponse(e),
      };
    }
  }
}
