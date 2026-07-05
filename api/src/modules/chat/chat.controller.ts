import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto, ChatSseEvent, ChatSseEventDto, ChatStartersDto } from './dto/chat.dto';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Chat with Robyn (SSE stream)',
    description:
      "Streams the agent's reply as Server-Sent Events. Each event is a JSON object on a `data:` line: {type:'text',delta}, {type:'tool',name,status:'running'|'done'|'error'}, {type:'error',message}, and a final {type:'done'}. The server is stateless — send the full history each time. The agent is strictly read-only: it consults live data but never writes to Xero or resolves tasks.",
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    type: ChatSseEventDto,
    description: 'text/event-stream of ChatSseEventDto-shaped JSON events (not a single JSON body).',
  })
  @ApiResponse({ status: 400, description: 'Malformed chat history.' })
  async chatStream(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Stop the Anthropic stream when the browser disconnects mid-answer.
    const aborter = new AbortController();
    res.on('close', () => aborter.abort());

    const emit = (evt: ChatSseEvent): void => {
      if (res.writableEnded || aborter.signal.aborted) return;
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
      // flush() exists only when a compression middleware wraps the response.
      (res as unknown as { flush?: () => void }).flush?.();
    };

    try {
      await this.chat.streamChat(dto, emit, aborter.signal);
      emit({ type: 'done' });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Chat failed unexpectedly.';
      emit({ type: 'error', message: message.slice(0, 300) });
      emit({ type: 'done' });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  @Get('starters')
  @ApiOperation({
    summary: 'Suggested chat questions',
    description:
      'Four canned questions computed cheaply from live data (leak totals, open task count) for the empty chat state.',
  })
  @ApiOkResponse({ type: ChatStartersDto })
  async starters(): Promise<ChatStartersDto> {
    return { starters: await this.chat.starters() };
  }
}
