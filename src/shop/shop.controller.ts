import { Body, Controller, Get, Post } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopDto } from 'src/validators/shop.dto';

@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}
  @Post('/api/create-product')
  addProduct(@Body() body: ShopDto) {
    return this.shopService.addProduct(body);
  }
  @Get('/api/fetch-products')
  fetchProducts() {
    return this.shopService.fetchProducts();
  }
}
