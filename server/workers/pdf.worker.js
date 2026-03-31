/**
 * Procesador de jobs PDF (BullMQ Worker o invocación directa).
 */
const pdfService = require('../services/pdf.service');
const jobStore = require('../lib/pdfJobsStore');

async function processPdfJob(job) {
  const { jobId, projectId, kind, userId } = job.data;
  const buffer = await pdfService.generateProjectPdf(projectId, kind === 'CLIENTE' ? 'CLIENTE' : 'GERENCIA');
  jobStore.setResult(jobId, buffer);

  try {
    await pdfService.saveSnapshot(projectId, kind, userId, {
      generatedAt: new Date().toISOString(),
      kind,
    });
  } catch (e) {
    console.warn('[PDF] snapshot:', e.message);
  }

  return { ok: true, jobId };
}

module.exports = { processPdfJob };
