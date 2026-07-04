import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Cron } from '@nestjs/schedule';

import { isServing } from '../../common/bootstrap-flag';
import { DetectionState, DetectionType } from '../../entities';
import { DetectionsService } from './detections.service';
import { DismissDetectionDto } from './dto/dismiss-detection.dto';
import {
  DetectionActionResultDto,
  DetectionDto,
  DetectionProposeResultDto,
  RunDetectorsResultDto,
} from './dto/detection-response.dto';

// Loop 3: the money-recovery surface. Three deterministic ledger detectors find
// billable work that never got invoiced (accepted quote, lapsed retainer,
// un-recharged expense). Detectors only PROPOSE — a human proposes/dismisses,
// and the invoice write itself goes through ProposalsModule + XeroService.
@ApiTags('detections')
@Controller('detections')
export class DetectionsController {
  constructor(private readonly detections: DetectionsService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the ledger detectors (check now)',
    description:
      'Runs three idempotent detectors — QUOTE_NOT_INVOICED, RETAINER_STOPPED and ' +
      'EXPENSE_NOT_RECHARGED. Reads Xero when it is live and falls back to local ' +
      'seed data otherwise (evidence.source records which path was used). New ' +
      'detections are deduped by a stable key, so re-running is safe. Returns the ' +
      'created rows plus counts.',
  })
  @ApiOkResponse({ type: RunDetectorsResultDto })
  run(): Promise<RunDetectorsResultDto> {
    return this.detections.runDetectors();
  }

  @Get()
  @ApiOperation({
    summary: 'List ledger detections',
    description:
      'All detections with type, matched client, recoverable value, evidence and ' +
      'state. Filter with ?state= and/or ?type=.',
  })
  @ApiQuery({ name: 'state', required: false, enum: DetectionState })
  @ApiQuery({ name: 'type', required: false, enum: DetectionType })
  @ApiOkResponse({ type: [DetectionDto] })
  list(
    @Query('state') state?: DetectionState,
    @Query('type') type?: DetectionType,
  ): Promise<DetectionDto[]> {
    return this.detections.list(state, type);
  }

  @Post(':id/propose')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Turn a detection into an invoice proposal',
    description:
      'Builds a single-line InvoiceProposal (provenance LEDGER) from the detection, ' +
      'sets it IN_REVIEW with 20% UK VAT, flips the detection to PROPOSED and raises ' +
      'a REVIEW_INVOICE task. Nothing is written to Xero here — approval lives in ' +
      'ProposalsModule. Idempotent: re-proposing returns the existing proposal.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DetectionProposeResultDto })
  propose(@Param('id', new ParseUUIDPipe()) id: string): Promise<DetectionProposeResultDto> {
    return this.detections.propose(id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dismiss a detection',
    description: 'Sets the detection DISMISSED and records the reason (optional) on the audit trail.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DetectionActionResultDto })
  dismiss(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DismissDetectionDto,
  ): Promise<DetectionActionResultDto> {
    return this.detections.dismiss(id, body?.reason);
  }

  // The same detector sweep, every 6 hours. Guarded so the OpenAPI export
  // (which builds the module graph but never serves) never fires it.
  @Cron('0 0 */6 * * *')
  async runDetectors(): Promise<void> {
    if (!isServing()) return;
    await this.detections.runDetectors();
  }
}
