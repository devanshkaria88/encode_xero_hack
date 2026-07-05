import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Google redirects the browser here with a variable query string: on success
// code+state (+scope/authuser/prompt, stripped by the whitelist pipe), on a
// cancelled consent screen error+state. Everything is optional so the endpoint
// can answer idempotently instead of failing validation.
export class GoogleCallbackQueryDto {
  @ApiPropertyOptional({ description: 'Single-use authorization code from Google.' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @ApiPropertyOptional({ description: 'State nonce issued by GET /google/auth-url.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  state?: string;

  @ApiPropertyOptional({ description: 'Error code when the user cancelled the consent screen.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;
}
