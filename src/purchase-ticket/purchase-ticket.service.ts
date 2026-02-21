import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PurchaseTicket } from 'src/entities/entity';
import { NetResponse } from 'src/helpers/types';
import PurchaseTicketDto from 'src/validators/purchase-ticket.dto';
import { Repository } from 'typeorm';

@Injectable()
export class PurchaseTicketService {
  constructor(
    @InjectRepository(PurchaseTicket)
    private readonly purchaseTicketDb: Repository<PurchaseTicket>,
  ) {}

  async createPurchaseTicket(params: PurchaseTicketDto): Promise<NetResponse> {
    const purchaseTicket = this.purchaseTicketDb.create(params);
    await this.purchaseTicketDb.save(purchaseTicket);
    return {
      success: true,
      message: 'Purchase ticket created successfully',
      data: null,
    };
  }

  async getPurchaseTicketsByUserId(ticketId: string): Promise<NetResponse> {
    const tickets = await this.purchaseTicketDb.findBy({ ticketId });
    return {
      success: true,
      message: 'Purchase tickets fetched successfully',
      data: tickets,
    };
  }
}
