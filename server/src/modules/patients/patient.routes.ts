import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  allergySchema,
  createPatientSchema,
  insuranceSchema,
  medicalHistorySchema,
  objectId,
  patientSearchQuery,
  recordConsentSchema,
  updatePatientSchema,
} from '@hms/shared';
import * as consent from './consent.service';
import * as portal from './portal-access.service';
import { env } from '../../config/env';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { can, requireCtx } from '../../core/context';
import { assertClinicalAccess } from './access';
import * as svc from './patient.service';
import { patientRegistrationPdf } from '../../core/pdf/documents';

export const patientRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
const idParam = validate(z.object({ id: objectId }), 'params');
const entryParam = validate(z.object({ id: objectId, entryId: objectId }), 'params');
const KIND = { allergies: allergySchema, history: medicalHistorySchema, insurance: insuranceSchema } as const;
const KIND_FIELD = { allergies: 'allergies', history: 'medicalHistory', insurance: 'insurances' } as const;

// Consent & communication preferences (append-only log; see consent.service)
patientRouter.get('/:id/consents', requirePermission('patients.view', 'portal.self'), idParam, ah(async (req, res) => res.json(await consent.listConsents(req.params.id))));
patientRouter.post('/:id/consents', requirePermission('patients.update', 'portal.self'), idParam, validate(recordConsentSchema), ah(async (req, res) => res.status(201).json(await consent.recordConsent(req.params.id, req.body))));

// Patient portal access (front desk / admin)
patientRouter.get('/:id/portal-account', requirePermission('patients.update'), idParam, ah(async (req, res) => res.json(await portal.portalAccountStatus(req.params.id))));
patientRouter.post('/:id/portal-account', requirePermission('patients.update'), idParam, validate(z.object({ email: z.string().trim().toLowerCase().email() })), ah(async (req, res) => res.status(201).json(await portal.enablePortalAccess(req.params.id, req.body.email))));
patientRouter.post('/:id/portal-account/disable', requirePermission('patients.update'), idParam, ah(async (req, res) => res.json(await portal.disablePortalAccess(req.params.id))));

patientRouter.get('/', requirePermission('patients.view'), validate(patientSearchQuery, 'query'), ah(async (req, res) => res.json(await svc.searchPatients(req.query as never))));

patientRouter.post(
  '/duplicates',
  requirePermission('patients.create'),
  validate(z.object({ cnic: z.string().max(20).optional(), phone: z.string().max(20).optional(), firstName: z.string().max(60).optional(), lastName: z.string().max(60).optional(), dateOfBirth: z.string().max(10).optional() })),
  ah(async (req, res) => res.json(await svc.findPossibleDuplicates(req.body))),
);

patientRouter.post('/', requirePermission('patients.create'), validate(createPatientSchema), ah(async (req, res) => res.status(201).json(await svc.registerPatient(req.body))));

patientRouter.get('/:id', requirePermission('patients.view', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.getPatient(req.params.id))));

patientRouter.patch('/:id', requirePermission('patients.update'), idParam, validate(updatePatientSchema), ah(async (req, res) => res.json(await svc.updatePatient(req.params.id, req.body))));

patientRouter.get(
  '/:id/registration-summary.pdf',
  requirePermission('patients.view'),
  idParam,
  ah(async (req, res) => {
    const pdf = await patientRegistrationPdf(req.params.id);
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="registration-${req.params.id}.pdf"`);
    res.send(pdf);
  }),
);

/**
 * Allergies / medical history / insurance. Registration staff (patients.update) maintain them for
 * any patient; clinicians (doctor, nurse) may add allergies and history only for patients under
 * their care. Insurance is demographic and needs patients.update.
 */
async function assertCanEditEntries(patientId: string, path: keyof typeof KIND) {
  if (can('patients.update')) return;
  if (path === 'insurance') throw new ForbiddenError();
  await assertClinicalAccess(patientId);
}

for (const [path, schema] of Object.entries(KIND) as Array<[keyof typeof KIND, (typeof KIND)[keyof typeof KIND]]>) {
  patientRouter.post(`/:id/${path}`, requirePermission('patients.update', 'clinical.consult', 'vitals.record'), idParam, validate(schema), ah(async (req, res) => {
    await assertCanEditEntries(req.params.id, path);
    res.status(201).json(await svc.addPatientEntry(req.params.id, KIND_FIELD[path], req.body));
  }));
  patientRouter.delete(`/:id/${path}/:entryId`, requirePermission('patients.update', 'clinical.consult'), entryParam, ah(async (req, res) => {
    await assertCanEditEntries(req.params.id, path);
    res.json(await svc.removePatientEntry(req.params.id, KIND_FIELD[path], req.params.entryId));
  }));
}

// Documents
patientRouter.get('/:id/documents', requirePermission('patients.documents', 'portal.self'), idParam, ah(async (req, res) => {
  await assertClinicalAccessOrDocs(req.params.id);
  res.json(await svc.listDocuments(req.params.id));
}));
patientRouter.post(
  '/:id/documents',
  requirePermission('patients.documents'),
  idParam,
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new BusinessRuleError('Attach a file');
    const meta = z.object({ category: z.string().trim().min(2).max(60), notes: z.string().trim().max(300).optional() }).parse(req.body);
    res.status(201).json(await svc.uploadDocument(req.params.id, req.file, meta));
  }),
);
patientRouter.get('/:id/documents/:entryId', requirePermission('patients.documents', 'portal.self'), entryParam, ah(async (req, res) => {
  await assertClinicalAccessOrDocs(req.params.id);
  const { doc, data } = await svc.downloadDocument(req.params.id, req.params.entryId);
  res.type(doc.contentType).setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}));

/** Portal patients may only reach their own documents; staff with patients.documents may reach any. */
async function assertClinicalAccessOrDocs(patientId: string) {
  if (requireCtx().patientId) await assertClinicalAccess(patientId);
}
