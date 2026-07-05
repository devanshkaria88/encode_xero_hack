import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Robyn API')
    .setDescription(
      'Robyn turns a freelancer\'s calendar, contracts and transcripts into invoices in Xero. ' +
        'Every agent behaviour is a state transition that writes to Xero or raises a Task. ' +
        'The LLM parses and proposes at the edges; it never decides and never sends.',
    )
    .setVersion('0.1.0')
    .addTag('tasks', 'Tasks inbox — resolvable cards')
    .addTag('meetings', 'Calendar loop — meetings, transcripts, matching')
    .addTag('clients', 'Clients, contracts, autonomy, potential-client queue')
    .addTag('proposals', 'Invoice proposals with line provenance')
    .addTag('detections', 'Ledger detectors (loop 3)')
    .addTag('connections', 'Integration health + check-now')
    .addTag('google', 'Google OAuth + calendar/gmail sync')
    .addTag('chat', 'Agentic chat + agent settings')
    .addTag('dashboard', 'Aggregate feeds: calendar view, leak strip, audit')
    .addTag('internal', 'Cron jobs exposed as POST /internal/run/:job')
    .build();
}
