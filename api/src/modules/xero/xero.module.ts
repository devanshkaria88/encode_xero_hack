import { Global, Module } from '@nestjs/common';
import { XeroService } from './xero.service';

// Global: the single Xero I/O surface. All Xero access in the app goes through
// XeroService, which wraps the one token path in xero-http.ts.
@Global()
@Module({
  providers: [XeroService],
  exports: [XeroService],
})
export class XeroModule {}
