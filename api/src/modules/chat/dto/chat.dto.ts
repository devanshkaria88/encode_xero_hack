import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const CHAT_ROLES = ['user', 'assistant'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export class ChatMessageDto {
  @ApiProperty({ description: 'Who said it.', enum: CHAT_ROLES })
  @IsIn(CHAT_ROLES as unknown as string[])
  role!: ChatRole;

  @ApiProperty({ description: 'Plain-text message content.', maxLength: 24000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(24000)
  content!: string;
}

export class ChatRequestDto {
  @ApiProperty({
    type: [ChatMessageDto],
    description:
      'Full conversation history, oldest first, ending with the latest user message. The server is stateless — the client keeps history.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

// The SSE event union streamed by POST /chat. Documented as a DTO so the shape
// lands in the OpenAPI spec even though the endpoint streams text/event-stream.
export class ChatSseEventDto {
  @ApiProperty({
    description:
      "Event discriminator. 'text' carries a delta; 'tool' carries name+status ('running'|'done'|'error'); 'error' carries message; 'done' ends the stream.",
    enum: ['text', 'tool', 'done', 'error'],
  })
  type!: 'text' | 'tool' | 'done' | 'error';

  @ApiProperty({ description: "Text delta (type='text').", required: false })
  delta?: string;

  @ApiProperty({ description: "Tool name (type='tool').", required: false })
  name?: string;

  @ApiProperty({
    description: "Tool status (type='tool').",
    required: false,
    enum: ['running', 'done', 'error'],
  })
  status?: 'running' | 'done' | 'error';

  @ApiProperty({ description: "Error message (type='error').", required: false })
  message?: string;
}

export class ChatStartersDto {
  @ApiProperty({
    type: [String],
    description: 'Four suggested questions computed from live data, for the empty chat state.',
  })
  starters!: string[];
}

// Internal event type used by the chat service / controller.
export type ChatSseEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error' }
  | { type: 'done' }
  | { type: 'error'; message: string };
