import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Shop } from 'src/entities/entity';
import { NetResponse } from 'src/helpers/types';
import { ShopDto } from 'src/validators/shop.dto';
import { Repository } from 'typeorm';

@Injectable()
export class ShopService {
  constructor(
    @InjectRepository(Shop)
    private readonly shopDb: Repository<Shop>,
  ) {}

  async addProduct(product: ShopDto): Promise<NetResponse> {
    try {
      const shop = this.shopDb.create(product);
      await this.shopDb.save(shop);
      return {
        success: true,
        message: 'Product added successfully',
        data: null,
      };
    } catch (e) {
      return {
        success: false,
        message: e as string,
        data: null,
      };
    }
  }

  async fetchProducts(): Promise<NetResponse> {
    const shop = await this.shopDb.find();
    if (shop) {
      return {
        success: true,
        message: 'Products fetched successfully',
        data: shop,
      };
    }
    return {
      success: false,
      message: 'No products found',
      data: null,
    };
  }
}
