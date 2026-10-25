import { Schema, model } from 'mongoose';
import { NOTIFICATION_TYPES } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

const deliverySchema = new Schema(
  {
    channel: { type: String, enum: ['Email', 'Sms', 'Push'], required: true },
    /**
     * Sent: accepted by a configured provider. Logged: demo mode (no provider configured — recorded,
     * not sent). Skipped: channel switched off for the hospital. OptedOut: the patient declined the
     * channel. Failed: provider error.
     */
    status: { type: String, enum: ['Sent', 'Logged', 'Failed', 'Skipped', 'OptedOut'], required: true },
    at: { type: Date, default: () => new Date() },
    error: String,
  },
  { _id: false },
);

const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', index: true },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  link: String,
  priority: { type: String, enum: ['Normal', 'High', 'Critical'], default: 'Normal' },
  readAt: Date,
  deliveries: [deliverySchema],
});
notificationSchema.plugin(basePlugin);
notificationSchema.index({ hospitalId: 1, userId: 1, readAt: 1, createdAt: -1 });
export const Notification = model('Notification', notificationSchema);
