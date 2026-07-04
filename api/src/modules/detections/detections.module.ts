import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Detection, Client, InvoiceProposal, Task } from '../../entities';

// Loop 3 ledger detectors: accepted quote never invoiced, retainer cadence
// broken (Payments data), billable expense never recharged. The detections
// agent implements the controller/service using XeroService.
@Module({
  imports: [TypeOrmModule.forFeature([Detection, Client, InvoiceProposal, Task])],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class DetectionsModule {}
