import { Module } from '@nestjs/common';
import { PurchaseTicketController } from './purchase-ticket.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseTicket } from 'src/entities/entity';
import { PurchaseTicketService } from './purchase-ticket.service';

@Module({
  imports: [TypeOrmModule.forFeature([PurchaseTicket])],
  controllers: [PurchaseTicketController],
  providers: [PurchaseTicketService],
})
export class PurchaseTicketModule {}
