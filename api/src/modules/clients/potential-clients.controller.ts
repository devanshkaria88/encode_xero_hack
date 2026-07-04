import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { DismissPotentialClientDto } from './dto/requests.dto';
import { PotentialClientDto, PromoteResultDto } from './dto/responses.dto';

@ApiTags('clients')
@Controller('potential-clients')
export class PotentialClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  @ApiOperation({
    summary: 'Potential-client queue',
    description:
      'The pipeline rail: prospects seen on the calendar but not yet in Xero, with watch state and the agreement-evidence quote once found.',
  })
  @ApiOkResponse({ type: [PotentialClientDto] })
  list(): Promise<PotentialClientDto[]> {
    return this.service.listPotentialClients();
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: 'Confirm & promote a prospect',
    description:
      'Loop-2 finish: create the Xero contact, create a real Client, raise ATTACH_CONTRACT and resolve the CONFIRM_AGREEMENT task. Xero failures are non-fatal — the prospect is still promoted locally.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PromoteResultDto })
  confirm(@Param('id', new ParseUUIDPipe()) id: string): Promise<PromoteResultDto> {
    return this.service.confirmPotentialClient(id);
  }

  @Post(':id/dismiss')
  @ApiOperation({
    summary: 'Dismiss a prospect',
    description: 'Remove a prospect from the pipeline and resolve its CONFIRM_AGREEMENT task.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PotentialClientDto })
  dismiss(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DismissPotentialClientDto,
  ): Promise<PotentialClientDto> {
    return this.service.dismissPotentialClient(id, body.reason);
  }
}
