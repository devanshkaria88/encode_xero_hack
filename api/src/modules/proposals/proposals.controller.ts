import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { InvoiceProposalState } from '../../entities';
import { ProposalsService } from './proposals.service';
import { PatchLinesDto } from './dto/patch-lines.dto';
import { RejectProposalDto } from './dto/reject-proposal.dto';
import {
  ProposalActionResultDto,
  ProposalDetailDto,
  ProposalSummaryDto,
} from './dto/proposal-response.dto';

@ApiTags('proposals')
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  @ApiOperation({
    summary: 'List invoice proposals',
    description:
      'All proposals with client name, source (meeting/detection), totals, state, policy verdict and Xero link. Filter with ?state=.',
  })
  @ApiQuery({ name: 'state', required: false, enum: InvoiceProposalState })
  @ApiOkResponse({ type: [ProposalSummaryDto] })
  list(@Query('state') state?: InvoiceProposalState): Promise<ProposalSummaryDto[]> {
    return this.proposals.list(state);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a proposal in full',
    description:
      'Full lines with provenance chips, policy reasons, the source evidence chain (meeting/transcript/detection/contract) and live Xero status.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProposalDetailDto })
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<ProposalDetailDto> {
    return this.proposals.detail(id);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve and send the proposal to Xero',
    description:
      'Writes an AUTHORISED ACCREC invoice (contact + invoice + decision note + evidence), sets state SENT, resolves the REVIEW_INVOICE task and marks the source meeting SENT. On Xero failure the proposal stays IN_REVIEW and the error is returned in the body (never a 500).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProposalActionResultDto })
  approve(@Param('id', new ParseUUIDPipe()) id: string): Promise<ProposalActionResultDto> {
    return this.proposals.approve(id);
  }

  @Post(':id/save-draft')
  @ApiOperation({
    summary: 'Create a DRAFT invoice in Xero',
    description:
      'Writes a DRAFT (unauthorised) ACCREC invoice to Xero and records its id + deep link, but keeps the proposal IN_REVIEW awaiting approval. On Xero failure the error is returned in the body (never a 500).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProposalActionResultDto })
  saveDraft(@Param('id', new ParseUUIDPipe()) id: string): Promise<ProposalActionResultDto> {
    return this.proposals.saveDraft(id);
  }

  @Post(':id/reject')
  @ApiOperation({
    summary: 'Reject the proposal',
    description: 'Sets state REJECTED, resolves the REVIEW_INVOICE task and records the reason on the audit trail.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProposalActionResultDto })
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RejectProposalDto,
  ): Promise<ProposalActionResultDto> {
    return this.proposals.reject(id, body.reason);
  }

  @Patch(':id/lines')
  @ApiOperation({
    summary: 'Edit the proposal lines',
    description: 'Replaces the line set before approval and recomputes line amounts + subtotal, tax and total.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProposalActionResultDto })
  patchLines(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PatchLinesDto,
  ): Promise<ProposalActionResultDto> {
    return this.proposals.patchLines(id, body.lines);
  }
}
