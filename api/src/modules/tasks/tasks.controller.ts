import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { TaskDto } from './dto/task.dto';
import { TaskCountsDto } from './dto/task-counts.dto';
import { ListTasksQueryDto } from './dto/list-tasks.query.dto';

// READ-ONLY inbox. Resolution happens in the owning modules (the card calls
// the endpoint in `context.action`); nothing here mutates state.
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  @ApiOperation({
    summary: 'List OPEN tasks (the inbox), newest first, each enriched with card context.',
  })
  @ApiOkResponse({ type: [TaskDto] })
  listOpen(): Promise<TaskDto[]> {
    return this.service.listOpen();
  }

  @Get('all')
  @ApiOperation({ summary: 'List all tasks (OPEN and RESOLVED); optional ?state= filter.' })
  @ApiOkResponse({ type: [TaskDto] })
  listAll(@Query() query: ListTasksQueryDto): Promise<TaskDto[]> {
    return this.service.listAll(query.state);
  }

  @Get('counts')
  @ApiOperation({ summary: 'OPEN task counts by type, for the inbox badges.' })
  @ApiOkResponse({ type: TaskCountsDto })
  counts(): Promise<TaskCountsDto> {
    return this.service.counts();
  }
}
