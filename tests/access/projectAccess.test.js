const assert = require('node:assert');
const { canReadProject, canWriteProject, canViewProjectAudit, canEditProjectKits } = require('../../server/utils/projectAccess');
const { canViewArchivedProjects } = require('../../server/utils/userRoles');

describe('visibilidad de proyectos por rol', () => {
  const owner = { id: 'a1', role: 'COMERCIAL' };
  const other = { id: 'c9', role: 'COMERCIAL' };
  const admin = { id: 'adm', role: 'ADMIN' };
  const superu = { id: 'su', role: 'SUPERUSER' };
  const viewer = { id: 'v1', role: 'VIEWER' };
  const project = { id: 'p1', created_by: owner.id, assigned_viewer: viewer.id };

  it('ADMIN lee todos los proyectos; no escribe los ajenos', () => {
    assert.strictEqual(canReadProject(admin, project, {}), true);
    assert.strictEqual(canWriteProject(admin, project, {}), false);
    assert.strictEqual(canWriteProject(admin, { ...project, created_by: admin.id }, {}), true);
  });

  it('COMERCIAL compartido no edita kits; ADMIN sí en proyectos ajenos', () => {
    assert.strictEqual(canEditProjectKits(other, project, { isSharedWithMe: true }), false);
    assert.strictEqual(canEditProjectKits(owner, project, {}), true);
    assert.strictEqual(canEditProjectKits(admin, project, {}), true);
  });

  it('VIEWER solo el asignado', () => {
    assert.strictEqual(canReadProject(viewer, project, {}), true);
    assert.strictEqual(canReadProject(viewer, { ...project, assigned_viewer: 'otro' }, {}), false);
    assert.strictEqual(canWriteProject(viewer, project, {}), false);
  });

  it('auditoría y archivados solo SUPERUSER', () => {
    assert.strictEqual(canViewProjectAudit(superu), true);
    assert.strictEqual(canViewProjectAudit(admin), false);
    assert.strictEqual(canViewArchivedProjects(superu), true);
    assert.strictEqual(canViewArchivedProjects(admin), false);
  });
});
