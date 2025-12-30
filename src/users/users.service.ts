import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/entities/entity';
import { NetResponse } from 'src/helpers/types';
import { UserDto } from 'src/validators/user.dto';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async saveUserData(userDetails: UserDto): Promise<NetResponse> {
    const user = this.userRepository.create(userDetails);

    await this.userRepository.save(user);
    return {
      success: true,
      message: 'User successfully added to database',
      data: null,
    };
  }

  async findAll(): Promise<NetResponse> {
    const users = await this.userRepository.find();
    if (users) {
      return {
        success: true,
        message: 'Available users',
        data: users,
      };
    }
    return {
      success: false,
      message: 'An error occured',
      data: null,
    };
  }

  async findUserById(id: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ id });

    if (user) {
      return {
        success: true,
        message: 'User found successfully',
        data: user,
      };
    }

    return {
      success: false,
      message: 'User not found',
      data: {},
    };
  }

  async findUserByName(name: string): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ name });
    if (user) {
      return {
        success: true,
        message: 'User found successfully',
        data: user,
      };
    }
    return {
      success: false,
      message: 'User not found',
      data: {},
    };
  }

  async checkUserCode(email: string, code: string): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ email });

    if (!user || !user.codeInfo) {
      return {
        success: false,
        message: 'User not found',
        data: {},
      };
    }

    const { code: storedCode, attempts } = user.codeInfo;

    if (attempts <= 0) {
      return {
        success: false,
        message: 'Code usage limit exceeded',
        data: {},
      };
    }

    if (storedCode !== code) {
      return {
        success: false,
        message: 'Invalid code',
        data: {},
      };
    }

    const newAttempts = attempts - 1;

    await this.userRepository.update(
      { id: user.id },
      {
        codeInfo: {
          ...user.codeInfo,
          attempts: newAttempts,
        },
      },
    );

    return {
      success: true,
      message: `Welcome ${user.name}`,
      data: {
        username: user.name,
        userId: user.id,
        attempts: newAttempts,
      },
    };
  }

  async saveUserScore(id: number, value: number): Promise<NetResponse> {
    // Find the user first
    const user = await this.userRepository.findOneBy({ id });

    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    // Update the score for the found user
    await this.userRepository.update(id, { score: value });

    return {
      success: true,
      message: 'Score saved successfully',
      data: null,
    };
  }

  logInAdmin(password: string): NetResponse {
    if (password['password'] == 'zelink123') {
      return {
        success: true,
        message: 'Welcome back admin',
        data: null,
      };
    }
    return {
      success: false,
      message: 'Invalid Credentials',
      data: null,
    };
  }

  async updateUserCode(
    id: number,
    code: string,
    uses: number,
  ): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (user) {
      await this.userRepository.update(id, {
        codeInfo: { ...user.codeInfo, code, attempts: uses },
      });
      return {
        success: true,
        message: 'User code updated successfully',
        data: null,
      };
    }
    return {
      success: false,
      message: 'User not found',
      data: null,
    };
  }

  async deleteUser(id: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (user) {
      await this.userRepository.delete(user.id);
      return {
        success: true,
        message: `${user.name} deleted successfully`,
        data: null,
      };
    }
    return {
      success: false,
      message: 'Unable to delete user',
      data: null,
    };
  }

  async updateParam(
    id: number,
    key: 'email' | 'name',
    param: string,
  ): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ id });
    if (user) {
      switch (key) {
        case 'email': {
          await this.userRepository.update(id, { email: param });
          break;
        }
        case 'name': {
          await this.userRepository.update(id, { name: param });
          break;
        }
      }
      return {
        success: true,
        message: 'User parameter updated successfully',
        data: null,
      };
    }
    return {
      success: false,
      message: 'User not found',
      data: null,
    };
  }

  pingServer(): NetResponse {
    return {
      success: true,
      message: ' success',
      data: null,
    };
  }
}
