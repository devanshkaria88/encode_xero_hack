import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TranscriptSource } from '../../../entities';

export class AttachTranscriptDto {
  @ApiProperty({ description: 'The pasted / uploaded transcript text.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200000)
  rawText!: string;

  @ApiPropertyOptional({ enum: TranscriptSource, enumName: 'TranscriptSource', default: TranscriptSource.PASTED })
  @IsOptional()
  @IsEnum(TranscriptSource)
  source?: TranscriptSource;
}

export class ConfirmClientDto {
  @ApiProperty({ description: 'The Client to bill this meeting to.' })
  @IsUUID()
  clientId!: string;
}

export class SkipMeetingDto {
  @ApiPropertyOptional({ description: 'Why the meeting is not billable.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ImportIcsDto {
  @ApiProperty({ description: 'Raw .ics calendar text to ingest.' })
  @IsString()
  @IsNotEmpty()
  icsText!: string;
}
