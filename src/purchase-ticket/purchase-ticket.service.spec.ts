import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseTicketService } from './purchase-ticket.service';

describe('PurchaseTicketService', () => {
  let service: PurchaseTicketService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseTicketService],
    }).compile();

    service = module.get<PurchaseTicketService>(PurchaseTicketService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
