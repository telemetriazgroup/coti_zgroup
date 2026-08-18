# -*- coding: utf-8 -*-
{
    'name': 'ZGROUP Partner Ext',
    'version': '17.0.1.0.0',
    'category': 'Hidden',
    'summary': 'UID externo e índice write_date en res.partner (integración Cotizaciones)',
    'description': """
Módulo mínimo para integrar Contactos Odoo 17 con ZGROUP Cotizaciones.

- Campo x_ztrack_uid: clave de idempotencia al crear contactos desde la app (etapa 5).
- Índice en write_date: pull incremental por watermark (etapa 3).

No hereda create/write. No hace HTTP. No toca el core más allá de este inherit.
    """,
    'author': 'ZGROUP',
    'license': 'LGPL-3',
    'depends': ['base'],
    'data': [],
    'installable': True,
    'application': False,
    'auto_install': False,
}
