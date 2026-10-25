import { Router } from 'express';
import { z } from 'zod';
import {
  completeConsultationSchema,
  consultationNoteSchema,
  createPrescriptionSchema,
  diagnosisSchema,
  nursingAssessmentSchema,
  objectId,
  treatmentPlanSchema,
  vitalsSchema,
} from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { prescriptionPdf } from '../../core/pdf/documents';
import * as svc from './clinical.service';
import { getEmr } from './emr.service';

export const clinicalRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');
const visitParam = validate(z.object({ visitId: objectId }), 'params');

// EMR
clinicalRouter.get('/emr/:id', requirePermission('emr.view', 'emr.view_all', 'portal.self'), idParam, ah(async (req, res) => res.json(await getEmr(req.params.id))));

// Vitals
clinicalRouter.get('/patients/:id/vitals', requirePermission('vitals.view', 'vitals.record', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.vitalsHistory(req.params.id))));
clinicalRouter.post('/patients/:id/vitals', requirePermission('vitals.record'), idParam, validate(vitalsSchema.and(z.object({ visitId: objectId.optional() }))), ah(async (req, res) => {
  const { visitId, ...vitals } = req.body;
  res.status(201).json(await svc.recordStandaloneVitals(req.params.id, vitals, visitId));
}));

// Nursing
clinicalRouter.get('/nursing/queue', requirePermission('nursing.queue'), ah(async (_req, res) => res.json(await svc.nursingQueue())));
clinicalRouter.get('/nursing/appointments/:id', requirePermission('vitals.record'), idParam, ah(async (req, res) => res.json(await svc.assessmentContext(req.params.id))));
clinicalRouter.post('/nursing/appointments/:id/start', requirePermission('vitals.record'), idParam, ah(async (req, res) => res.json(await svc.startAssessment(req.params.id))));
clinicalRouter.post('/nursing/appointments/:id/submit', requirePermission('vitals.record'), idParam, validate(nursingAssessmentSchema), ah(async (req, res) => res.json(await svc.submitAssessment(req.params.id, req.body))));

// Doctor
clinicalRouter.get('/doctor/queue', requirePermission('clinical.queue'), ah(async (_req, res) => res.json(await svc.doctorQueue())));
clinicalRouter.get('/doctor/appointments/:id', requirePermission('clinical.consult'), idParam, ah(async (req, res) => res.json(await svc.consultationContext(req.params.id))));
clinicalRouter.post('/doctor/appointments/:id/start', requirePermission('clinical.consult'), idParam, ah(async (req, res) => res.json(await svc.startConsultation(req.params.id))));
clinicalRouter.post('/doctor/appointments/:id/complete', requirePermission('clinical.consult'), idParam, validate(completeConsultationSchema), ah(async (req, res) => res.json(await svc.completeConsultation(req.params.id, req.body))));

clinicalRouter.put('/visits/:visitId/note', requirePermission('clinical.consult'), visitParam, validate(consultationNoteSchema), ah(async (req, res) => res.json(await svc.saveConsultationNote(req.params.visitId, req.body))));
clinicalRouter.post('/visits/:visitId/diagnoses', requirePermission('clinical.consult'), visitParam, validate(diagnosisSchema), ah(async (req, res) => res.status(201).json(await svc.addDiagnosis(req.params.visitId, req.body))));
clinicalRouter.delete('/visits/:visitId/diagnoses/:id', requirePermission('clinical.consult'), validate(z.object({ visitId: objectId, id: objectId }), 'params'), ah(async (req, res) => {
  await svc.removeDiagnosis(req.params.visitId, req.params.id);
  res.status(204).end();
}));
clinicalRouter.put('/visits/:visitId/treatment-plan', requirePermission('clinical.consult'), visitParam, validate(treatmentPlanSchema), ah(async (req, res) => res.json(await svc.saveTreatmentPlan(req.params.visitId, req.body))));
clinicalRouter.post('/visits/:visitId/prescriptions', requirePermission('prescriptions.create'), visitParam, validate(createPrescriptionSchema), ah(async (req, res) => res.status(201).json(await svc.createPrescription(req.params.visitId, req.body))));

// Prescriptions
clinicalRouter.get('/patients/:id/prescriptions', requirePermission('prescriptions.view', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.listPatientPrescriptions(req.params.id))));
clinicalRouter.get('/prescriptions/:id', requirePermission('prescriptions.view', 'pharmacy.dispense', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.getPrescription(req.params.id))));
clinicalRouter.get('/prescriptions/:id/pdf', requirePermission('prescriptions.view', 'pharmacy.dispense', 'portal.self'), idParam, ah(async (req, res) => {
  const pdf = await prescriptionPdf(req.params.id);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="prescription-${req.params.id}.pdf"`);
  res.send(pdf);
}));
clinicalRouter.post('/prescriptions/:id/cancel', requirePermission('prescriptions.create'), idParam, validate(z.object({ reason: z.string().trim().min(3).max(300) })), ah(async (req, res) => res.json(await svc.cancelPrescription(req.params.id, req.body.reason))));
