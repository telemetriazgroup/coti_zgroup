# -*- coding: utf-8 -*-
"""Extensión mínima de res.partner: UID externo + índice write_date.

No sobreescribir create/write. No llamadas HTTP desde Odoo.
"""

from odoo import fields, models, tools


class ResPartner(models.Model):
    _inherit = 'res.partner'

    x_ztrack_uid = fields.Char(
        string='UID Ztrack',
        index=True,
        copy=False,
        help='Clave de idempotencia de Cotizaciones ZGROUP. No editar a mano.',
    )

    _sql_constraints = [
        (
            'x_ztrack_uid_uniq',
            'unique(x_ztrack_uid)',
            'UID externo duplicado (x_ztrack_uid)',
        ),
    ]

    def init(self):
        # Odoo no indexa write_date por defecto; el pull incremental lo necesita.
        tools.create_index(
            self._cr,
            'res_partner_write_date_idx',
            self._table,
            ['write_date'],
        )
