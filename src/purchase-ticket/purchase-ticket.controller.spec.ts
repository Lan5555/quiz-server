import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseTicketController } from './purchase-ticket.controller';

describe('PurchaseTicketController', () => {
  let controller: PurchaseTicketController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseTicketController],
    }).compile();

    controller = module.get<PurchaseTicketController>(PurchaseTicketController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
