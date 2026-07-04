import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Detection, Client, InvoiceProposal, Task } from '../../entities';
import { DetectionsController } from './detections.controller';
import { DetectionsService } from './detections.service';

// Loop 3 ledger detectors: accepted quote never invoiced, retainer cadence
// broken (Payments data), billable expense never recharged. Reads Xero when
// live (via the global XeroService) and falls back to local seed data so the
// recovery loop always demos. Detectors only PROPOSE — the invoice write lives
// in ProposalsModule + XeroService.
@Module({
  imports: [TypeOrmModule.forFeature([Detection, Client, InvoiceProposal, Task])],
  providers: [DetectionsService],
  controllers: [DetectionsController],
  exports: [TypeOrmModule],
})
export class DetectionsModule {}
