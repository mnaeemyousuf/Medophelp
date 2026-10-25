import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';
import { Button, Card, Input, PageHeader, Select } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/data';
import { Badge } from '@/components/ui/badge';
import type { Patient } from '@/types';

export function PatientsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [gender, setGender] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useQuery({
    queryKey: ['patients', debounced, gender, page, sort],
    queryFn: () => api.get<Paged<Patient>>('/patients', { search: debounced, gender, page, pageSize: 20, sort }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Patients"
        description="Search by name, MRN, CNIC or phone number."
        actions={can('patients.create') && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => navigate('/patients/new')}>Register patient</Button>}
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, MRN (SH-2026-000001), CNIC or phone" className="pl-8" />
          </div>
          <Select value={gender} onChange={(e) => { setGender(e.target.value); setPage(1); }} className="sm:w-40">
            <option value="">All genders</option>
            <option>Male</option>
            <option>Female</option>
            <option>Other</option>
          </Select>
        </div>
        <DataTable
          sort={sort}
          onSort={(s) => { setSort(s); setPage(1); }}
          loading={isFetching}
          rows={data?.items}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/patients/${p.id}`)}
          empty={{
            icon: <Users className="h-5 w-5" />,
            title: debounced ? 'No matching patients' : 'No patients yet',
            description: debounced ? 'Check the spelling or search by MRN / phone. If this is a new patient, register them.' : undefined,
            action: can('patients.create') ? <Button size="sm" onClick={() => navigate('/patients/new')}>Register patient</Button> : undefined,
          }}
          columns={[
            { key: 'mrn', header: 'MRN', sortKey: 'mrn', cell: (p) => <span className="num font-mono text-xs font-medium">{p.mrn}</span> },
            {
              key: 'name',
              sortKey: 'name',
              header: 'Patient',
              cell: (p) => (
                <div>
                  <p className="font-medium">{p.fullName}</p>
                  <p className="text-xs text-muted md:hidden">{p.phone}</p>
                </div>
              ),
            },
            { key: 'age', header: 'Age / Sex', cell: (p) => `${p.age ?? '—'} / ${p.gender[0]}` },
            { key: 'phone', header: 'Phone', cell: (p) => <span className="num">{p.phone}</span>, hideOnMobile: true },
            { key: 'cnic', header: 'CNIC / ID', cell: (p) => <span className="num">{p.cnic ?? '—'}</span>, hideOnMobile: true },
            { key: 'city', header: 'City', sortKey: 'city', cell: (p) => p.city ?? '—', hideOnMobile: true },
            { key: 'reg', header: 'Registered', sortKey: 'registered', cell: (p) => <span className="text-muted">{formatDate(p.createdAt)}</span>, hideOnMobile: true },
            { key: 'flag', header: '', cell: (p) => (p.isProvisional ? <Badge tone="warn">Provisional</Badge> : null) },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
