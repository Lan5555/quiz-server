import { IsInt, IsObject, IsString } from 'class-validator';

export class ShopDto {
  @IsString()
  name: string;
  @IsInt()
  price: number;
  @IsString()
  icon: string;
  @IsString()
  description: string;
}

export class PayedDto {
  @IsInt()
  productId: number;
  @IsObject()
  params: { attempts: number; time: number };
}
