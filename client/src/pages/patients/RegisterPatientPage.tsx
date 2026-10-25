import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import { ALLERGY_SEVERITIES, BLOOD_GROUPS, GENDERS, createPatientSchema } from '@hms/shared';
import { api, ApiError, openPdf } from '@/lib/api';
import { formatDate, todayIso } from '@/lib/utils';
import { Button, Card, Input, PageHeader, Select } from '@/components/ui/primitives';
import { Field, FormSection, handleFormError } from '@/components/form/Field';
import { Dialog } from '@/components/ui/overlay';
import type { Patient } from '@/types';

type FormIn = z.input<typeof createPatientSchema>;
type FormOut = z.output<typeof createPatientSchema>;
interface Dupe {
  id: string;
  mrn: string;
  name: string;
  dateOfBirth: string;
  phone: string;
  sameCnic: boolean;
}

export function RegisterPatientPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dupes, setDupes] = useState<{ list: Dupe[]; blocking: boolean; values: FormOut } | null>(null);
  const [withInsurance, setWithInsurance] = useState(false);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: { gender: 'Male', bloodGroup: 'Unknown', allergies: [], medicalHistory: [] },
  });
  const { register, formState: { errors, isSubmitting } } = form;
  const allergies = useFieldArray({ control: form.control, name: 'allergies' });
  const history = useFieldArray({ control: form.control, name: 'medicalHistory' });

  const save = async (values: FormOut) => {
    try {
      const p = await api.post<Patient>('/patients', { ...values, insurance: withInsurance ? values.insurance : undefined });
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success(`Registered ${p.fullName}`, {
        description: `MRN ${p.mrn}`,
        action: { label: 'Print summary', onClick: () => void openPdf(`/patients/${p.id}/registration-summary.pdf`) },
      });
      navigate(`/patients/${p.id}`);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'possible_duplicate' || e.code === 'duplicate_patient')) {
        setDupes({ list: (e.details?.duplicates ?? []) as Dupe[], blocking: e.code === 'duplicate_patient', values });
        return;
      }
      handleFormError(e, form.setError);
    }
  };

  return (
    <>
      <PageHeader title="Register patient" description="An MRN is generated automatically when you save." />
      <form onSubmit={form.handleSubmit(save)} noValidate>
        <Card className="p-5">
          <FormSection title="Identity">
            <Field label="First name" required error={errors.firstName}><Input autoFocus {...register('firstName')} /></Field>
            <Field label="Last name" required error={errors.lastName}><Input {...register('lastName')} /></Field>
            <Field label="Father / husband name" error={errors.guardianName}><Input {...register('guardianName')} /></Field>
            <Field label="CNIC / ID" error={errors.cnic} hint="12345-1234567-1 or passport no."><Input inputMode="numeric" {...register('cnic')} /></Field>
            <Field label="Date of birth" required error={errors.dateOfBirth}><Input type="date" max={todayIso()} {...register('dateOfBirth')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gender" required error={errors.gender}>
                <Select {...register('gender')}>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select>
              </Field>
              <Field label="Blood group" error={errors.bloodGroup}>
                <Select {...register('bloodGroup')}>{BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}</Select>
              </Field>
            </div>
          </FormSection>

          <FormSection title="Contact">
            <Field label="Phone" required error={errors.phone}><Input type="tel" placeholder="+92 300 1234567" {...register('phone')} /></Field>
            <Field label="Email" error={errors.email}><Input type="email" {...register('email')} /></Field>
            <Field label="City" error={errors.city}><Input {...register('city')} /></Field>
            <Field label="Address" error={errors.address} className="sm:col-span-2 lg:col-span-3"><Input {...register('address')} /></Field>
            <Field label="Emergency contact name" error={errors.emergencyContactName}><Input {...register('emergencyContactName')} /></Field>
            <Field label="Relation" error={errors.emergencyContactRelation}><Input {...register('emergencyContactRelation')} /></Field>
            <Field label="Emergency contact phone" error={errors.emergencyContactPhone}><Input type="tel" {...register('emergencyContactPhone')} /></Field>
          </FormSection>

          <section className="border-b border-border py-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Allergies</h3>
                <p className="text-xs text-muted">Shown prominently on every clinical screen and checked when prescribing.</p>
              </div>
              <Button type="button" variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => allergies.append({ allergen: '', severity: 'Moderate' })}>Add allergy</Button>
            </div>
            {allergies.fields.map((f, i) => (
              <div key={f.id} className="mt-3 grid grid-cols-[1fr_1fr_140px_auto] items-end gap-2">
                <Field label="Allergen" error={errors.allergies?.[i]?.allergen}><Input {...register(`allergies.${i}.allergen`)} /></Field>
                <Field label="Reaction"><Input {...register(`allergies.${i}.reaction`)} /></Field>
                <Field label="Severity"><Select {...register(`allergies.${i}.severity`)}>{ALLERGY_SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
                <Button type="button" variant="ghost" size="icon" onClick={() => allergies.remove(i)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </section>

          <section className="border-b border-border py-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Medical history</h3>
              <Button type="button" variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => history.append({ condition: '', isChronic: false })}>Add condition</Button>
            </div>
            {history.fields.map((f, i) => (
              <div key={f.id} className="mt-3 grid grid-cols-[1fr_160px_auto_auto] items-end gap-2">
                <Field label="Condition" error={errors.medicalHistory?.[i]?.condition}><Input {...register(`medicalHistory.${i}.condition`)} /></Field>
                <Field label="Diagnosed on"><Input type="date" max={todayIso()} {...register(`medicalHistory.${i}.diagnosedOn`, { setValueAs: (v) => v || undefined })} /></Field>
                <label className="mb-2 flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" {...register(`medicalHistory.${i}.isChronic`)} /> Chronic</label>
                <Button type="button" variant="ghost" size="icon" onClick={() => history.remove(i)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </section>

          <section className="py-5">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={withInsurance} onChange={(e) => setWithInsurance(e.target.checked)} /> Patient has insurance
            </label>
            {withInsurance && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Provider" required error={errors.insurance?.provider}><Input {...register('insurance.provider')} /></Field>
                <Field label="Policy number" required error={errors.insurance?.policyNumber}><Input {...register('insurance.policyNumber')} /></Field>
                <Field label="Coverage %" error={errors.insurance?.coveragePercent}><Input type="number" min={0} max={100} {...register('insurance.coveragePercent')} /></Field>
                <Field label="Expires on" error={errors.insurance?.expiresOn}><Input type="date" {...register('insurance.expiresOn', { setValueAs: (v) => v || undefined })} /></Field>
              </div>
            )}
          </section>
        </Card>
        <div className="sticky bottom-16 mt-4 flex justify-end gap-2 lg:bottom-0">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>Register & generate MRN</Button>
        </div>
      </form>

      <Dialog
        open={!!dupes}
        onClose={() => setDupes(null)}
        title={dupes?.blocking ? 'Patient already registered' : 'Possible duplicate'}
        description={dupes?.blocking ? 'This CNIC/ID belongs to an existing patient. Open their record instead.' : 'These existing patients look similar. Avoid creating a second record for the same person.'}
        footer={
          <>
            <Button variant="outline" onClick={() => setDupes(null)}>Back to form</Button>
            {!dupes?.blocking && (
              <Button onClick={() => { const v = dupes!.values; setDupes(null); void save({ ...v, confirmNotDuplicate: true }); }}>It's a new patient — register</Button>
            )}
          </>
        }
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {dupes?.list.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {d.sameCnic && <AlertTriangle className="h-4 w-4 text-danger" />}
              <div className="flex-1">
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-muted">{d.mrn} · DOB {formatDate(d.dateOfBirth)} · {d.phone}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${d.id}`)}>Open</Button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
