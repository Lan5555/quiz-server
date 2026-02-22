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

  async getPurchaseTicketsByUserId(id: string): Promise<NetResponse> {
    const ticketId = id.startsWith('#') ? id : `#${id}`;

    const tickets = await this.purchaseTicketDb.findBy({ ticketId });

    if (tickets.length > 0) {
      return {
        success: true,
        message: 'Purchase tickets fetched successfully',
        data: tickets,
      };
    }

    return {
      success: false,
      message: 'No purchase tickets found for the given ticket ID',
      data: null,
    };
  }

  async getNumberOfRegisteredStudents(): Promise<NetResponse> {
    try {
      const db = await this.purchaseTicketDb.find();
      if (db) {
        return {
          success: true,
          message: 'Data fetched successfully',
          data: db,
        };
      } else {
        return {
          success: false,
          message: 'No data found',
          data: null,
        };
      }
    } catch (e) {
      return {
        success: false,
        message: 'An error has occured' + e,
        data: null,
      };
    }
  }
}
