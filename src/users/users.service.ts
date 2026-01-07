import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/entities/entity';
import { NetResponse } from 'src/helpers/types';
import { PayedDto } from 'src/validators/shop.dto';
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

  async findUserById(userId: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });

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
      { userId: user.userId },
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
        userId: user.userId,
        attempts: newAttempts,
        time: user.time,
      },
    };
  }

  async saveUserScore(userId: number, value: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });

    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    user.score = value;
    await this.userRepository.save(user); // ✅ updates Neon correctly

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
    userId: number,
    code: string,
    uses: number,
  ): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    user.codeInfo = { ...user.codeInfo, code, attempts: uses };
    await this.userRepository.save(user); // updates JSON properly

    return {
      success: true,
      message: 'User code updated successfully',
      data: null,
    };
  }

  async deleteUser(userId: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'Unable to delete user',
        data: null,
      };
    }

    await this.userRepository.remove(user); // ✅ deletes the correct row

    return {
      success: true,
      message: `${user.name} deleted successfully`,
      data: null,
    };
  }

  async updateParam(
    userId: number,
    key: 'email' | 'name',
    param: string,
  ): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    user[key] = param; // ✅ update property dynamically
    await this.userRepository.save(user); // ✅ ensures Neon gets the update

    return {
      success: true,
      message: 'User parameter updated successfully',
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

  async logInStudent(email: string, code: string): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ email });
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    } else if (user.email === email && user.codeInfo.code === code) {
      return {
        success: true,
        message: `Welcome back ${user.name}`,
        data: user,
      };
    } else {
      return {
        success: false,
        message: 'Invalid Credentials',
        data: null,
      };
    }
  }

  async updateUserItems(val: PayedDto, userId: number): Promise<NetResponse> {
    const user = await this.userRepository.findOneBy({ userId });

    if (!user) {
      return {
        success: false,
        message: 'User not found',
        data: null,
      };
    }

    // Update the fields
    switch (val.productId) {
      case 1: // attempts
        user.codeInfo = {
          ...user.codeInfo,
          attempts: (user.codeInfo?.attempts || 0) + (val.params.attempts || 0),
        };
        break;

      case 2: // time
        user.time = (user.time || 0) + (val.params.time || 0);
        break;

      default: // fallback
        user.codeInfo = {
          ...user.codeInfo,
          attempts: (user.codeInfo?.attempts || 0) + (val.params.attempts || 0),
        };
        break;
    }

    await this.userRepository.save(user); // ✅ ensures Neon updates JSON correctly

    return {
      success: true,
      message: 'Updated successfully',
      data: user,
    };
  }
}
