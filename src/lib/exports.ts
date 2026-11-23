import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ActivityLog,
  Committee,
  Delegate,
  QuorumMetrics,
  Session,
  UnmodBloc,
} from '../types/mun';
import { computeDelegateTotalScore, formatClock } from './munRules';

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCommitteeCsv(
  committee: Committee,
  session: Session | undefined,
  delegates: Delegate[],
  logs: ActivityLog[]
): void {
  const header = [
    'Country',
    'Code',
    'Current Session Status',
    'Total Score',
    'Speeches',
    'POIs',
    'Motions Proposed',
    'Motions Passed',
    'Main Sub Speeches',
    'Amendments Proposed',
    'Amendments Passed',
    'Amendment Speeches',
    'Chair Notes',
    'Recent Activity & Speech Notes',
  ];

  const sorted = [...delegates].sort((a, b) => a.countryName.localeCompare(b.countryName));

  const rows = sorted.map((d) => {
    const status = session?.attendance?.[d.id] || 'absent';
    const statusLabel = status === 'pv' ? 'Present & Voting' : status === 'present' ? 'Present' : 'Absent';
    const delegateLogs = logs
      .filter((l) => l.delegateId === d.id)
      .slice(0, 12)
      .map((l) => {
        const noteStr = l.note ? ` — "${l.note}"` : '';
        return `[${l.caucusMode}] ${l.type}${l.topic ? `: ${l.topic}` : ''}${noteStr}`;
      })
      .join(' | ');

    return [
      d.countryName,
      d.countryCode,
      statusLabel,
      computeDelegateTotalScore(d),
      d.speechesCount,
      d.poisCount,
      d.motionsProposedCount,
      d.motionsAcceptedCount,
      d.mainSubSpeechesCount || 0,
      d.amendmentsProposedCount || 0,
      d.amendmentsPassedCount || 0,
      d.amendmentSpeechesCount || 0,
      d.chairNotes || '',
      delegateLogs,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = committee.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'ChairOS_Export';
  link.href = url;
  link.download = `${safeName}_Stats.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportCommitteePdf(
  committee: Committee,
  session: Session | undefined,
  quorum: QuorumMetrics,
  delegates: Delegate[],
  logs: ActivityLog[],
  blocs: UnmodBloc[]
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(0, 71, 171);
  doc.rect(0, 0, pageWidth, 68, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`ChairOS | ${committee.name}`, 36, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `Committee Dossier · ${session?.name || 'Session 1'} · Generated ${new Date().toLocaleDateString()}`,
    36,
    50
  );

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Session Quorum & Voting Thresholds', 36, 94);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Delegations: ${quorum.totalDelegations}   |   Present + P&V: ${quorum.activeTotal} (P&V: ${quorum.pvCount}, Present: ${quorum.presentCount}, Absent: ${quorum.absentCount})`,
    36,
    112
  );
  doc.text(
    `Quorum (${quorum.quorumMet ? 'MET' : 'NOT MET'}, min ${quorum.quorumNeeded}):   Simple (${quorum.simpleFractionLabel}): ${quorum.simpleMajority}   |   Supermajority (${quorum.superFractionLabel}): ${quorum.twoThirdsMajority}`,
    36,
    128
  );

  const rankedDelegates = [...delegates].sort((a, b) => {
    const scoreA = computeDelegateTotalScore(a);
    const scoreB = computeDelegateTotalScore(b);
    return scoreB - scoreA || a.countryName.localeCompare(b.countryName);
  });

  autoTable(doc, {
    startY: 146,
    margin: { left: 36, right: 36 },
    headStyles: { fillColor: [0, 71, 171], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [
      ['Delegation', 'Status', 'Total', 'Sp', 'POI', 'Mot (P/Pass)', 'Res/Am (MS/AmS/AmP)', 'Chair Notes'],
    ],
    body: rankedDelegates.map((d) => {
      const st = session?.attendance?.[d.id] || 'absent';
      const stLabel = st === 'pv' ? 'P&V' : st === 'present' ? 'Present' : 'Absent';
      return [
        d.countryName,
        stLabel,
        String(computeDelegateTotalScore(d)),
        String(d.speechesCount),
        String(d.poisCount),
        `${d.motionsProposedCount}/${d.motionsAcceptedCount}`,
        `${d.mainSubSpeechesCount || 0}/${d.amendmentSpeechesCount || 0}/${d.amendmentsPassedCount || 0}`,
        d.chairNotes ? d.chairNotes.slice(0, 120) : '—',
      ];
    }),
  });

  if (blocs.length > 0) {
    const afterTableY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 400;
    const nextY = afterTableY > 680 ? (doc.addPage(), 48) : afterTableY + 26;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Working Papers & Bloc Notes', 36, nextY);

    autoTable(doc, {
      startY: nextY + 10,
      margin: { left: 36, right: 36 },
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: [15, 23, 42] },
      head: [['Bloc / Paper', 'Sponsors', 'Chair Notes']],
      body: blocs.map((b) => [b.title, b.sponsors || '—', b.notes || '—']),
    });
  }

  if (logs.length > 0) {
    const afterPrevY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 400;
    const nextY = afterPrevY > 680 ? (doc.addPage(), 48) : afterPrevY + 26;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Chronological Speech, POI, Motion & Amendment Log', 36, nextY);

    autoTable(doc, {
      startY: nextY + 10,
      margin: { left: 36, right: 36 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
      head: [['Delegate', 'Mode', 'Type', 'Time / Outcome', 'Topic & Individual Note']],
      body: logs.slice(0, 80).map((l) => [
        l.delegateName,
        l.caucusMode,
        l.type.toUpperCase(),
        l.durationSeconds > 0 ? formatClock(l.durationSeconds) : l.outcome || '—',
        [
          l.topic,
          l.targetDelegateName ? `-> ${l.targetDelegateName}` : '',
          l.yieldType ? `Yield: ${l.yieldType}` : '',
          l.note ? `Note: ${l.note}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || '—',
      ]),
    });
  }

  const safeName = committee.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'ChairOS_Dossier';
  doc.save(`${safeName}_Dossier.pdf`);
}
