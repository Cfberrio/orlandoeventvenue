# Revenue Reports Database Schema

## Overview

The `booking_revenue_items` table provides a detailed line-item ledger for comprehensive revenue analysis. Each booking can have multiple revenue line items, enabling granular reporting by category, type, and time period.

## Table: `booking_revenue_items`

### Schema

```sql
CREATE TABLE public.booking_revenue_items (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  
  -- Categorization
  item_category text NOT NULL,  -- Category of revenue
  item_type text,               -- Specific type within category
  
  -- Financial
  amount decimal(10,2) NOT NULL,
  quantity integer DEFAULT 1,
  unit_price decimal(10,2),
  
  -- Description
  description text,
  metadata jsonb DEFAULT '{}',
  
  -- Audit
  is_historical boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### Categories (`item_category`)

| Category | Description | Examples |
|----------|-------------|----------|
| `baseline` | Base venue rental | daily, hourly |
| `cleaning_base` | Base cleaning fee | touch_up ($40), regular ($80), deep ($150) |
| `cleaning_surcharge` | Celebration/guest surcharge | celebration ($20-$70) |
| `production` | Production packages | basic, led, workshop |
| `addon` | Optional add-ons | tablecloth, setup_breakdown, misc |
| `fee` | Additional fees | overtime, damage, special_request |
| `discount` | Discounts (negative) | Discount codes |
| `tax` | Taxes and fees | taxes_fees |

## Helper Functions

### 1. `get_revenue_by_category(start_date, end_date)`

Returns revenue breakdown by category and type.

```sql
SELECT * FROM get_revenue_by_category('2026-01-01', '2026-12-31');
```

**Returns:** category, item_type, total_amount, item_count

### 2. `get_revenue_by_segment(start_date, end_date, segment_by)`

Returns revenue grouped by booking attribute.

```sql
-- By event type
SELECT * FROM get_revenue_by_segment('2026-01-01', '2026-12-31', 'event_type');

-- By booking origin
SELECT * FROM get_revenue_by_segment('2026-01-01', '2026-12-31', 'booking_origin');

-- By package
SELECT * FROM get_revenue_by_segment('2026-01-01', '2026-12-31', 'package');
```

**Returns:** segment, total_revenue, booking_count, avg_revenue

### 3. `get_daily_revenue(start_date, end_date)`

Returns daily revenue with category breakdown.

```sql
SELECT * FROM get_daily_revenue('2026-02-01', '2026-02-28');
```

**Returns:** revenue_date, total_revenue, booking_count, baseline_revenue, cleaning_revenue, production_revenue, addon_revenue, fee_revenue, discount_amount, tax_amount

### 4. `get_monthly_revenue(start_date, end_date)`

Returns monthly revenue summary.

```sql
SELECT * FROM get_monthly_revenue('2026-01-01', '2026-12-31');
```

**Returns:** revenue_month, year_month, total_revenue, booking_count, baseline_revenue, cleaning_revenue, production_revenue, addon_revenue

### 5. `get_revenue_line_items_export(start_date, end_date)`

Returns detailed line items for CSV export.

```sql
SELECT * FROM get_revenue_line_items_export('2026-01-01', '2026-12-31');
```

**Returns:** reservation_number, event_date, event_type, booking_type, booking_origin, guest_name, item_category, item_type, amount, quantity, description, created_at

## Populating Revenue Items

### For New Bookings

Call `populate_booking_revenue_items(booking_id)` after:
- Stripe payment completion
- Admin creates internal/external booking
- Price updates on existing booking

```sql
SELECT populate_booking_revenue_items('booking-uuid-here');
```

### For Historical Backfill

```sql
SELECT populate_booking_revenue_items('booking-uuid', true);  -- true = mark as historical
```

## Revenue Analysis Examples

### Total Revenue by Month (2026)

```sql
SELECT 
  revenue_month,
  total_revenue,
  booking_count,
  baseline_revenue,
  cleaning_revenue
FROM get_monthly_revenue('2026-01-01', '2026-12-31');
```

### Cleaning Revenue Breakdown

```sql
SELECT 
  item_type,
  SUM(amount) as total
FROM booking_revenue_items
WHERE item_category IN ('cleaning_base', 'cleaning_surcharge')
GROUP BY item_type;
```

### Revenue by Event Type

```sql
SELECT * FROM get_revenue_by_segment('2026-01-01', '2026-12-31', 'event_type');
```

### Export for Accounting (CSV-ready)

```sql
COPY (
  SELECT * FROM get_revenue_line_items_export('2026-01-01', '2026-12-31')
) TO '/tmp/revenue-export.csv' WITH CSV HEADER;
```

## Security

- RLS enabled: Only admin and staff can view revenue items
- Only admin can create/update/delete revenue items
- All helper functions use `SECURITY DEFINER` with `search_path = public`

## Adding New Revenue Types

To add a new revenue type (e.g., equipment rental):

1. Add to `item_category` CHECK constraint if needed
2. Update `populate_booking_revenue_items()` function
3. Re-run backfill if applicable

```sql
-- Example: Insert equipment rental line item
INSERT INTO booking_revenue_items (
  booking_id,
  item_category,
  item_type,
  amount,
  description
) VALUES (
  'booking-uuid',
  'addon',
  'equipment_rental',
  75.00,
  'Speaker System Rental'
);
```
