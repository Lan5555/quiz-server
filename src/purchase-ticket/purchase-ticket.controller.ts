import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PurchaseTicketService } from './purchase-ticket.service';
import PurchaseTicketDto from 'src/validators/purchase-ticket.dto';

@Controller('purchase-ticket')
export class PurchaseTicketController {
  constructor(private readonly purchaseTicketService: PurchaseTicketService) {}
  @Post('/api/create-ticket')
  async createPurchaseTicket(@Body() params: PurchaseTicketDto) {
    return this.purchaseTicketService.createPurchaseTicket(params);
  }
  @Get('/api/get-tickets')
  async getPurchaseTicketsByUserId(@Query('ticketId') ticketId: string) {
    return this.purchaseTicketService.getPurchaseTicketsByUserId(ticketId);
  }
  @Get('/get-registered-students')
  async getNumberOfRegisteredStudents() {
    return await this.purchaseTicketService.getNumberOfRegisteredStudents();
  }
}
