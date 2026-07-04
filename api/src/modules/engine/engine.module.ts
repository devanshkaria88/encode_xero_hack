import { Global, Module } from '@nestjs/common';
import { EngineService } from './engine.service';

// Pure reconciliation core — no I/O, no repos, no LLM. Global so any service
// can price a proposal or run the policy without re-importing.
@Global()
@Module({
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
