import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { UpdateAutonomyDto, UpsertContractDto } from './dto/requests.dto';
import {
  ClientDetailDto,
  ClientListItemDto,
  ContractDto,
} from './dto/responses.dto';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  @ApiOperation({
    summary: 'List clients',
    description:
      'Every client with billing profile, autonomy state, contract summary, unbilled exposure and invoice-history count.',
  })
  @ApiOkResponse({ type: [ClientListItemDto] })
  list(): Promise<ClientListItemDto[]> {
    return this.service.listClients();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Client detail',
    description: 'Full client detail: parsed contract with clauses, invoice history and unbilled exposure.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientDetailDto })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<ClientDetailDto> {
    return this.service.getClient(id);
  }

  @Patch(':id/autonomy')
  @ApiOperation({
    summary: 'Toggle autonomy',
    description:
      'Flip the per-client auto-send policy. ON lets Robyn send invoices without asking, within contract terms.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientListItemDto })
  setAutonomy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAutonomyDto,
  ): Promise<ClientListItemDto> {
    return this.service.setAutonomy(id, body.enabled);
  }

  @Post(':id/contract')
  @ApiOperation({
    summary: 'Attach / re-parse a contract',
    description:
      'Parse pasted contract text into rate, terms and cited clauses, file it against the client, set the billing profile, and resolve any ATTACH_CONTRACT task.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ContractDto })
  attachContract(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpsertContractDto,
  ): Promise<ContractDto> {
    return this.service.upsertContract(id, body);
  }

  @Get(':id/contract')
  @ApiOperation({
    summary: 'Get parsed contract',
    description: 'The contract on file with its parsed clauses for the clause viewer. Null if none is filed.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ContractDto })
  getContract(@Param('id', new ParseUUIDPipe()) id: string): Promise<ContractDto | null> {
    return this.service.getContract(id);
  }
}
