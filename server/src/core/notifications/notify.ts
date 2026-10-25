import type { Types } from 'mongoose';
import type { NotificationType } from '@hms/shared';
import { env } from '../../config/env';
import { Notification } from '../../modules/notifications/notification.model';
import { Hospital } from '../../modules/organization/organization.models';
import { Patient } from '../../modules/patients/patient.models';
import { User } from '../../modules/identity/identity.models';
import { allowedChannels } from '../../modules/patients/consent.service';
import { logger } from '../logger';
import { currentHospitalId } from '../context';

type Channel = 'Email' | 'Sms' | 'Push';
type Recipient = { userId?: Types.ObjectId; patientId?: Types.ObjectId };

/**
 * Channel adapters. `configured` adapters really deliver (status "Sent"); unconfigured ones run in
 * demo mode and only log a redacted line (status "Logged"), so the notification history never
 * claims a message was delivered when it was not.
 */
export interface ChannelSender {
  configured: boolean;
  provider: string;
  send(to: Recipient, title: string, message: string): Promise<void>;
}

const demoSender = (channel: string): ChannelSender => ({
  configured: false,
  provider: 'Demo mode (not sent)',
  async send(to, title) {
    // Never log message bodies: they can contain clinical details.
    logger.info({ channel, userId: to.userId?.toString(), patientId: to.patientId?.toString(), title }, 'notification logged (demo mode, not sent)');
  },
});

async function phoneOf(to: Recipient) {
  if (to.patientId) return (await Patient.findById(to.patientId).select('phone').lean())?.phone;
  if (to.userId) return (await User.findById(to.userId).select('phone').lean())?.phone;
  return undefined;
}

/** Generic HTTP SMS gateway: POST { to, from, text } as JSON with a bearer key. */
const httpSmsSender = (url: string): ChannelSender => ({
  configured: true,
  provider: new URL(url).host,
  async send(to, title, message) {
    const phone = await phoneOf(to);
    if (!phone) throw new Error('No mobile number on file');
    // Keep SMS short and free of detailed clinical content (SMS is not a secure channel).
    const text = `${title}: ${message}`.slice(0, 300);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(env.SMS_API_KEY ? { Authorization: `Bearer ${env.SMS_API_KEY}` } : {}) },
      body: JSON.stringify({ to: phone.replace(/[^\d+]/g, ''), from: env.SMS_SENDER_ID, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Gateway responded ${res.status}`);
  },
});

export const channels: Record<Channel, ChannelSender> = {
  Email: demoSender('email'),
  Sms: env.SMS_GATEWAY_URL ? httpSmsSender(env.SMS_GATEWAY_URL) : demoSender('sms'),
  Push: demoSender('push'),
};

/** What the settings screen shows: whether each external channel can really deliver. */
export const integrationStatus = () =>
  (Object.keys(channels) as Channel[]).map((c) => ({ channel: c, configured: channels[c].configured, provider: channels[c].provider }));

export interface NotifyInput {
  type: NotificationType;
  title: string;
  message: string;
  userIds?: Types.ObjectId[];
  patientId?: Types.ObjectId;
  link?: string;
  priority?: 'Normal' | 'High' | 'Critical';
  /** External channels to attempt in addition to the in-app notification. */
  external?: Channel[];
}

/**
 * Creates in-app notifications and dispatches external channels that are enabled for the hospital
 * and allowed by the patient's communication preferences. Delivery outcomes are recorded on the
 * notification, never thrown to the caller.
 */
export async function notify(input: NotifyInput) {
  const hospital = await Hospital.findById(currentHospitalId()).select('notifications').lean();
  const enabled: Record<Channel, boolean> = {
    Email: hospital?.notifications?.email ?? false,
    Sms: hospital?.notifications?.sms ?? false,
    Push: hospital?.notifications?.push ?? false,
  };
  const recipients: Recipient[] = input.userIds?.length ? input.userIds.map((userId) => ({ userId, patientId: input.patientId })) : [{ patientId: input.patientId }];
  // Staff messages addressed to a user do not depend on the patient's preferences.
  const patientPrefs = input.patientId && input.external?.length && !input.userIds?.length ? await allowedChannels(input.patientId) : null;

  const docs = [];
  for (const to of recipients) {
    const deliveries: Array<{ channel: Channel; status: 'Sent' | 'Logged' | 'Failed' | 'Skipped' | 'OptedOut'; error?: string }> = [];
    for (const ch of input.external ?? []) {
      if (!enabled[ch]) {
        deliveries.push({ channel: ch, status: 'Skipped' });
        continue;
      }
      if (patientPrefs && !patientPrefs[ch]) {
        deliveries.push({ channel: ch, status: 'OptedOut' });
        continue;
      }
      try {
        await channels[ch].send(to, input.title, input.message);
        deliveries.push({ channel: ch, status: channels[ch].configured ? 'Sent' : 'Logged' });
      } catch (err) {
        deliveries.push({ channel: ch, status: 'Failed', error: (err as Error).message });
      }
    }
    docs.push({ userId: to.userId, patientId: to.patientId, type: input.type, title: input.title, message: input.message, link: input.link, priority: input.priority ?? 'Normal', deliveries });
  }
  await Notification.insertMany(docs.map((d) => ({ ...d, hospitalId: currentHospitalId() })));
}
