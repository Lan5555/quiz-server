import { IsInt, IsString } from 'class-validator';

class PurchaseTicketDto {
  @IsString()
  name: string;
  @IsInt()
  price: number;
  @IsString()
  email: string;
  @IsString()
  phone: string;
  @IsString()
  ticketId: string;
  @IsString()
  purchaseDate: string;
}

export default PurchaseTicketDto;
