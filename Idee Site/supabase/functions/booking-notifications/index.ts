import { createHandler } from './handler.ts';

Deno.serve(createHandler({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  cancellationSecret: Deno.env.get('BOOKING_CANCELLATION_SECRET') ?? '',
  bookingMakeWebhookURL: Deno.env.get('BOOKING_MAKE_WEBHOOK_URL') || undefined,
  chatMakeWebhookURL: Deno.env.get('CHAT_MAKE_WEBHOOK_URL') || undefined,
}));
