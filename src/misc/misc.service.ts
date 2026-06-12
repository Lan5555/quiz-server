import { Injectable } from '@nestjs/common';
import { CreateMiscDto } from './dto/create-misc.dto';
import { UpdateMiscDto } from './dto/update-misc.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Misc } from './entities/misc.entity';
import { NetResponse } from 'src/helpers/types';
import { User } from 'src/entities/entity';

@Injectable()
export class MiscService {
  constructor(
    @InjectRepository(Misc)
    private readonly miscRepository: Repository<Misc>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async create(createMiscDto: CreateMiscDto): Promise<NetResponse> {
    try {
      const misc = this.miscRepository.create(createMiscDto);
      const savedMisc = await this.miscRepository.save(misc);
      return {
        success: true,
        message: 'Misc entry created successfully',
        data: savedMisc,
      };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : 'Failed to create misc entry',
        data: null,
      };
    }
  }

  async findAll(): Promise<NetResponse> {
    const data = await this.miscRepository.find();
    return {
      success: true,
      message: 'Misc entries fetched successfully',
      data,
    };
  }

  async findOne(id: number): Promise<NetResponse> {
    const data = await this.miscRepository.findOneBy({ id });
    return {
      success: true,
      message: 'Misc entry fetched successfully',
      data,
    };
  }

  async update(id: number, updateMiscDto: UpdateMiscDto): Promise<NetResponse> {
    await this.miscRepository.update(id, updateMiscDto);
    return this.findOne(id);
  }

  async remove(id: number): Promise<NetResponse> {
    await this.miscRepository.delete(id);
    return {
      success: true,
      message: 'Misc entry removed successfully',
      data: null,
    };
  }

  async checkIfValid(userId: number, key: string): Promise<NetResponse> {
    const entry = await this.miscRepository.findOneBy({ value: key });
    const user = await this.userRepository.findOneBy({ userId: userId });
    if (user?.quizId === null) {
      return {
        success: false,
        message: 'User does not have a pending quiz',
        data: null,
      };
    }
    if (!entry) {
      return {
        success: false,
        message: 'Key is not valid',
        data: null,
      };
    }

    return {
      success: true,
      message: entry ? 'Key is valid' : 'Key is not valid',
      data: { ...entry, userId: user?.userId, quizId: user?.quizId },
    };
  }
  async deleteKey(id: number) {
    const entry = await this.miscRepository.findOneBy({ key: id.toString() });
    if (!entry) {
      return;
    }
    await this.miscRepository.delete(id);
    return {
      success: true,
      message: 'Key deleted successfully',
      data: null,
    };
  }
}
