# Lógica de Estados de Reservas — Modelo Conceptual

> Documento **conceptual**, agnóstico de tecnología. Describe *cómo piensa* el sistema los estados de una reserva, no cómo está programado.
> Para replicar en otro venue con cualquier stack.

---

## 1. Idea central: una reserva tiene DOS vidas paralelas

El error más Acomún al modelar reservas es usar **un solo estado** que mezcla "¿en qué punto del evento estamos?" con "¿cuánto pagó el cliente?". Eso genera estados imposibles tipo `confirmado-pero-sin-pagar-y-medio-pagado` que no caben en un solo campo.

La solución: **dos ejes independientes** que avanzan a su propio ritmo.

```
        EJE OPERATIVO (tiempo/evento)          EJE FINANCIERO (dinero)
        ──────────────────────────────         ───────────────────────
        ¿Dónde está el evento en su            ¿Cuánto ha pagado el
        ciclo de vida?                          cliente?

        pending                                 pending (lead)
        confirmed                               deposit_paid
        pre_event_ready                         fully_paid
        in_progress                             (failed / refunded /
        post_event                               invoiced)
        closed
        cancelled
```

Una reserva real es siempre **un punto en cada eje a la vez**. Ej: `(confirmed, deposit_paid)` = confirmada, con depósito, falta balance. Esto es legítimo y común.

**Por qué importa:** el dinero y el tiempo no están sincronizados. El cliente puede pagar el balance una semana antes del evento o el mismo día. El evento avanza por calendario; el pago avanza por acciones del cliente. Mezclarlos = perder información.

### Regla de oro
> Un evento de pago **nunca** mueve el eje operativo, y una acción operativa **nunca** mueve el eje financiero.
> Se cruzan solo en las **guardas** (ver §5), no en las transiciones.

---

## 2. Eje operativo (lifecycle) — el ciclo de vida del evento

Representa el viaje físico del evento en el tiempo. Avanza casi siempre en una sola dirección (es una línea de tiempo, no un ida y vuelta).

```
pending ──▶ confirmed ──▶ pre_event_ready ──▶ in_progress ──▶ post_event ──▶ closed
   │            │               │                  │              │
   └────────────┴───────────────┴──────────────────┴──────────────┴──▶ cancelled
```

| Estado | Significado conceptual | Quién lo causa |
|--------|------------------------|----------------|
| **pending** | Llegó una solicitud. Nadie la ha revisado. | Cliente (crea la reserva) |
| **confirmed** | El venue acepta la reserva. Existe el compromiso. | Pago de depósito o admin |
| **pre_event_ready** | Todo listo para el día: staff, logística, servicios. Arranca la cuenta regresiva automática. | Admin (con checklist) |
| **in_progress** | El evento está sucediendo ahora. | El reloj (llega la hora) |
| **post_event** | El evento terminó. Falta cerrar: reportes, reseña. | El reloj (pasó la fecha + margen) |
| **closed** | Todo cerrado y revisado. Estado terminal feliz. | Admin (confirma cierre) |
| **cancelled** | Se canceló. Estado terminal triste. | Admin / cliente |

### Tres tipos de "motor" mueven este eje
1. **Acción humana** (admin): `pending → confirmed`, `confirmed → pre_event_ready`, `post_event → closed`. Decisiones que requieren criterio.
2. **El reloj** (tiempo): `pre_event_ready → in_progress`, `in_progress → post_event`. Automáticas, basadas en `fecha_evento`.
3. **Excepción** (cancelación): desde casi cualquier estado → `cancelled`.

### Estados terminales
`closed` y `cancelled` son finales. No salen de ahí. Todo lo demás es transitorio.

---

## 3. Eje financiero (payment) — el dinero

```
pending ──▶ deposit_paid ──▶ fully_paid
   │                              
   ├──▶ failed (intento fallido, vuelve a intentar)
   ├──▶ refunded (se devolvió)
   └──▶ invoiced (facturado, ruta alterna a depósito/balance)
```

| Estado | Significado |
|--------|-------------|
| **pending** | No ha pagado nada. ⚠️ Esto define un **LEAD** (ver §4). |
| **deposit_paid** | Pagó el depósito (típico 50%). Hay compromiso real. |
| **fully_paid** | Pagó el balance. Saldado. |
| **failed** | Un cobro falló. Transitorio, se reintenta. |
| **refunded** | Se reembolsó (normalmente tras cancelación). |
| **invoiced** | Ruta de factura (clientes externos / addons), en vez del flujo depósito→balance. |

El motor de este eje es **siempre el dinero**: un pago entra, un reembolso sale. Nunca lo mueve el calendario ni el admin operativo (salvo override manual explícito).

---

## 4. El concepto "LEAD" — un estado *derivado*, no almacenado

Esto es sutil y potente: **"lead" no es un estado guardado**. Es una **interpretación** que surge de cruzar los dos ejes.

> **LEAD** = `lifecycle: pending` **Y** `payment: pending`

Es decir: solicitud que llegó pero **sin dinero todavía**. El sistema lo trata distinto:
- No bloquea el calendario (no es una reserva real aún, solo interés).
- En la lista, los `pending` se **sub-dividen visualmente**:
  - **Leads** → sin depósito (`payment: pending`)
  - **Pending Review** → con depósito (`payment: deposit_paid`), ya merecen revisión real

**Lección de modelado:** algunos "estados" útiles no se almacenan — se **calculan** combinando los ejes. No agregues una columna `is_lead`; derívala. Así nunca queda inconsistente.

Otros estados derivados parecidos:
- **"Bloquea calendario"** = `payment ∈ {deposit_paid, fully_paid, invoiced}` y `lifecycle ≠ cancelled`. Solo reservas con dinero ocupan fechas.
- **"Listo para evento"** (`pre_event_ready` flag) puede existir como bandera separada del lifecycle, indicando que se cumplió el checklist aunque el lifecycle aún no haya avanzado.

---

## 5. Guardas — dónde SÍ se cruzan los dos ejes

Las transiciones de un eje no tocan el otro, **pero algunas transiciones se bloquean según el estado del otro eje u otras condiciones**. Ahí viven las reglas de negocio.

| Transición | Guarda (condición para permitirla) |
|------------|-----------------------------------|
| → `confirmed` | Normalmente requiere depósito pagado (configurable por venue) |
| → `pre_event_ready` | Servicios extra deben estar resueltos (ej: si hay bar, vendor asignado + cliente contactado) |
| → `cancelled` | Prohibido si el evento ya está `closed`/`completed` |
| reschedule (cambio de fecha) | Prohibido si `cancelled` o `closed` |
| bloquear fecha en calendario | Solo si hay dinero (no leads) |

**Patrón general de guarda:** "para pasar de A a B, primero deben cumplirse N condiciones". Si no, se rechaza con un mensaje claro ("No se puede marcar listo: falta asignar vendor de bar").

Las guardas son el lugar correcto para la lógica de negocio — no las transiciones en sí. Mantiene cada eje limpio.

---

## 6. Configurabilidad por venue (clave para multi-venue)

Cada venue tiene **políticas** que activan/desactivan reglas sin reescribir la máquina de estados. Conceptualmente, banderas como:

- `requires_payment` — ¿el depósito es obligatorio para confirmar? (Si no, se confirma sin dinero.)
- `auto_lifecycle_transitions` — ¿el reloj avanza el lifecycle solo, o todo es manual?
- `requires_staff_assignment` — ¿se exige staff antes de `pre_event_ready`?
- banderas de comunicación: enviar confirmación, recordatorios de depósito, recordatorios de balance.

**Idea:** la **máquina de estados es la misma** para todos los venues; lo que cambia es **qué guardas y automatizaciones están activas**. Eso te da multi-venue sin bifurcar la lógica. Para el venue nuevo, replica la máquina y solo ajusta sus políticas.

---

## 7. Origen de la reserva afecta el punto de entrada

No todas las reservas empiezan en el mismo lugar del eje operativo.

| Origen | Empieza en | Razón |
|--------|-----------|-------|
| **Website** (cliente) | `pending` | Llega cruda, sin revisar |
| **Internal** (admin la crea) | `confirmed` directo | El admin ya decidió; salta la revisión |
| **External** (admin, tercero) | `confirmed` directo | Igual, ya es un compromiso |

El origen **no es un estado** — es un atributo que decide el **estado inicial** y cómo se visualiza/filtra. Tres atributos distintos: *de dónde viene* (origen), *dónde está* (lifecycle), *cuánto pagó* (payment).

---

## 8. Efectos en cascada — cuando un estado cambia, el mundo reacciona

Las transiciones no son solo cambiar una etiqueta. Disparan **efectos secundarios**. Modelar esto es parte de la lógica de estados.

**Al entrar a `pre_event_ready`:** arranca la automatización pre-evento → se programan recordatorios de balance y reportes. (La cuenta regresiva del evento empieza aquí.)

**Al pagar el balance (`fully_paid`):** se cancelan los recordatorios de pago pendientes (ya no hace falta perseguir al cliente).

**Al `cancelled`:** cascada de limpieza —
1. Cancelar todos los trabajos/recordatorios programados pendientes.
2. Liberar las fechas que ocupaba en el calendario.
3. Registrar el evento de cancelación (auditoría).
4. Sincronizar la cancelación a sistemas externos (CRM).

**Regla:** cada transición debe definir *qué pasa además del cambio de estado*. Un estado sin efectos es solo una etiqueta; los efectos son donde vive el valor operativo.

---

## 9. Rastro de auditoría — la historia, no solo el presente

Los dos ejes te dicen **dónde está** la reserva ahora. Pero también se registra **cómo llegó ahí**: cada cambio importante deja un evento con marca de tiempo y el **estado anterior**.

Ejemplos de eventos registrados: confirmación enviada, recordatorios (72h/24h/3h antes), link post-evento enviado, solicitud de reseña, cancelación.

**Por qué:** el estado actual es una foto; el rastro es la película. Para soporte, disputas y métricas necesitas la película. Conceptualmente: **el estado es derivable del rastro**, pero se guarda el estado actual por velocidad.

---

## 10. Invariantes — lo que SIEMPRE debe ser verdad

Reglas que el sistema nunca debe violar (úsalas como tests al replicar):

1. Una reserva tiene **exactamente un** valor en cada eje, siempre.
2. `cancelled` y `closed` son **terminales** — nada sale de ellos.
3. Una reserva que **bloquea calendario** ⟹ tiene dinero (`payment ∈ {deposit_paid, fully_paid, invoiced}`).
4. Un **lead** (`pending`+`pending`) **nunca** bloquea calendario.
5. Un evento de pago **solo** cambia el eje financiero.
6. Una acción del reloj **solo** cambia el eje operativo.
7. No se cancela algo ya `closed`; no se reagenda algo `cancelled`/`closed`.
8. Si `payment` retrocede a `refunded`, normalmente fue precedido por `cancelled` en el otro eje.
9. Todo cambio de estado relevante deja un registro de auditoría.

---

## 11. Resumen en una frase

> Modela la reserva como **dos máquinas de estado paralelas** (evento + dinero) que avanzan independientes, se cruzan solo en **guardas**, derivan estados como "lead" en vez de almacenarlos, disparan **efectos en cascada** en cada transición, y dejan **rastro de auditoría** — todo afinado por venue mediante **políticas**, sin tocar la máquina base.

---

## Preguntas abiertas para el venue nuevo

Para adaptar esta lógica necesito saber (si quieres precisión):

1. **¿Depósito obligatorio?** ¿Una reserva puede confirmarse sin pago, o el depósito es lo que confirma?
2. **¿Cuántos pasos operativos** necesitas realmente? (Quizá no requieras `pre_event_ready` separado de `confirmed`.)
3. **¿Hay servicios extra con guarda** (bar, catering) que bloqueen el avance, como aquí?
4. **¿El lifecycle avanza solo con el reloj** o prefieres que todo sea manual?
5. **¿Reservas por hora, por día, o ambas?** (afecta cómo se bloquea el calendario)
6. **¿Necesitas el concepto de "lead"** (interés sin pago) o toda reserva nace ya comprometida?
