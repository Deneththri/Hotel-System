CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.hotel_bookings (
  reference text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW')),
  type_id text NOT NULL,
  room_name text NOT NULL,
  room_number integer NOT NULL,
  guest text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  requests text NOT NULL DEFAULT '',
  check_in date NOT NULL,
  check_out date NOT NULL,
  CHECK (check_out > check_in),
  guests integer NOT NULL CHECK (guests > 0),
  pricing jsonb NOT NULL,
  payment text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS hotel_bookings_email_reference_idx
  ON public.hotel_bookings (email, reference);
CREATE INDEX IF NOT EXISTS hotel_bookings_stay_dates_idx
  ON public.hotel_bookings (check_in, check_out);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hotel_bookings_room_dates_excl'
      AND conrelid = 'public.hotel_bookings'::regclass
  ) THEN
    ALTER TABLE public.hotel_bookings
      ADD CONSTRAINT hotel_bookings_room_dates_excl
      EXCLUDE USING gist (
        type_id WITH =,
        room_number WITH =,
        daterange(check_in, check_out, '[)') WITH &&
      )
      WHERE (status IN ('CONFIRMED', 'CHECKED_IN'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.hotel_orders (
  reference text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('RECEIVED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED')),
  guest text NOT NULL,
  email text NOT NULL,
  room_number integer,
  booking_reference text REFERENCES public.hotel_bookings (reference) ON DELETE SET NULL,
  lines jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  pricing jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  history jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS hotel_orders_email_reference_idx
  ON public.hotel_orders (email, reference);
CREATE INDEX IF NOT EXISTS hotel_orders_status_created_idx
  ON public.hotel_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS hotel_orders_booking_reference_idx
  ON public.hotel_orders (booking_reference);

ALTER TABLE public.hotel_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_orders ENABLE ROW LEVEL SECURITY;
