-- Kamal Medical Hall Database Schema
-- Apply this schema to your Supabase PostgreSQL database
-- Run via Supabase SQL editor at https://supabase.com/dashboard

-- Enable UUID generation extension
create extension if not exists "uuid-ossp";

-- Main users table - all roles (customer, admin, delivery_partner)
create table users (
    id uuid primary key default uuid_generate_v4(),
    phone text not null unique,
    role text not null check (role in ('customer', 'admin', 'delivery_partner')),
    name text,
    email text,
    language text,
    avatar_public_id text,
    avatar_resource_type text,
    gender text,
    date_of_birth date,
    city text,
    is_active boolean default true,
    firebase_uid text unique,
    signed_up_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- OTP codes for SMS verification
create table otp_codes (
    phone text primary key,
    code_hash text not null,
    expires_at timestamptz not null,
    attempts int default 0,
    last_sent_at timestamptz,
    sends int default 1,
    window_started_at timestamptz
);

-- Store settings (single row, id=1)
create table store_settings (
    id int primary key default 1 check (id = 1),
    is_open boolean default true,
    opening_time text default '09:00',
    closing_time text default '21:00',
    order_cutoff_time interval default '1 hour',
    address text,
    phone text,
    email text,
    latitude double precision,
    longitude double precision,
    upi_id text,
    upi_name text,
    bank_name text,
    bank_account_name text,
    bank_account_number text,
    bank_ifsc text,
    terms_text text,
    terms_updated_at timestamptz,
    logo_public_id text
);

-- Addresses for customers
create table addresses (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references users(id) on delete cascade,
    label text,
    recipient_name text,
    phone text,
    line1 text,
    line2 text,
    landmark text,
    pincode text,
    latitude double precision,
    longitude double precision,
    created_at timestamptz default now()
);

-- Device tokens for push notifications
create table device_tokens (
    token text primary key,
    user_id uuid references users(id) on delete cascade,
    platform text not null check (platform in ('android', 'ios')),
    created_at timestamptz default now()
);

-- Account requests (deactivation requests, etc.)
create table account_requests (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references users(id) on delete cascade,
    kind text not null check (kind in ('deactivate', 'reactivate')),
    reason text,
    details jsonb,
    created_at timestamptz default now(),
    resolved_at timestamptz,
    resolved_by uuid references users(id)
);

-- Service pincode areas
create table service_pincodes (
    pincode text primary key,
    area text,
    active boolean default true,
    created_at timestamptz default now()
);

-- Delivery partner assignments to pincode areas
create table partner_pincodes (
    partner_id uuid references users(id) on delete cascade,
    pincode text references service_pincodes(pincode),
    primary key (partner_id, pincode)
);

-- Medicine names (free-text entry for prescriptions)
create table medicines (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    quantity text,
    created_at timestamptz default now()
);

-- Orders
create table orders (
    id uuid primary key default uuid_generate_v4(),
    customer_id uuid references users(id) on delete cascade,
    kind text not null check (kind in ('catalogue', 'prescription')),
    note text,
    address_snapshot jsonb,
    delivery_date date,
    delivery_slot text,
    idempotency_key text unique,
    status text default 'requested' check (status in ('requested', 'quote_sent', 'quote_rejected', 'accepted', 'paid', 'out_for_delivery', 'delivered', 'cancelled', 'returned')),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Order items
create table order_items (
    id uuid primary key default uuid_generate_v4(),
    order_id uuid references orders(id) on delete cascade,
    name text not null,
    quantity int not null default 1,
    created_at timestamptz default now()
);

-- Prescription files
create table prescriptions (
    id uuid primary key default uuid_generate_v4(),
    order_id uuid references orders(id) on delete cascade,
    url text not null,
    public_id text not null,
    mime_type text not null,
    size_bytes int not null,
    resource_type text not null check (resource_type in ('image', 'video', 'pdf')),
    created_at timestamptz default now()
);

-- Order status history
create table status_history (
    id uuid primary key default uuid_generate_v4(),
    order_id uuid references orders(id) on delete cascade,
    status text not null check (status in ('requested', 'quote_sent', 'quote_rejected', 'accepted', 'paid', 'out_for_delivery', 'delivered', 'cancelled', 'returned')),
    actor_id uuid references users(id),
    reason text,
    created_at timestamptz default now()
);

-- Payments
create table payments (
    id uuid primary key default uuid_generate_v4(),
    order_id uuid references orders(id) on delete cascade,
    method text not null check (method in ('razorpay', 'cod')),
    amount int not null,
    status text not null check (status in ('cod_pending', 'paid', 'refunded', 'cancelled')),
    razorpay_order_id text,
    collected_by uuid references users(id), -- partner who collected
    collected_via text check (collected_via in ('cash', 'upi')),
    collection_ref text,
    collected_at timestamptz,
    created_at timestamptz default now()
);

-- Delivery assignments
create table assignments (
    id uuid primary key default uuid_generate_v4(),
    order_id uuid references orders(id) on delete cascade unique,
    partner_id uuid references users(id) on delete cascade,
    assigned_at timestamptz default now(),
    accepted_at timestamptz,
    completed_at timestamptz
);

-- Store closed days (for delivery scheduling)
create table store_closed_days (
    day date primary key
);

-- Attendance for delivery partners
create table attendance (
    id uuid primary key default uuid_generate_v4(),
    partner_id uuid references users(id) on delete cascade,
    day date not null,
    status text not null check (status in ('present', 'absent', 'paid_leave', 'leave', 'break')),
    checked_in_at timestamptz,
    checked_out_at timestamptz,
    created_at timestamptz default now(),
    unique(partner_id, day)
);

-- Reviews
create table reviews (
    id uuid primary key default uuid_generate_v4(),
    order_id uuid references orders(id) on delete cascade unique,
    customer_id uuid references users(id) on delete cascade,
    rating int not null check (rating >= 1 and rating <= 5),
    comment text,
    created_at timestamptz default now()
);

-- Review images
create table review_images (
    id uuid primary key default uuid_generate_v4(),
    review_id uuid references reviews(id) on delete cascade,
    public_id text not null,
    mime_type text not null,
    resource_type text,
    size_bytes int,
    created_at timestamptz default now()
);

-- Chat threads
create table chat_threads (
    id uuid primary key default uuid_generate_v4(),
    customer_id uuid references users(id) on delete cascade,
    order_id uuid references orders(id) on delete cascade,
    subject text,
    status text default 'open' check (status in ('open', 'closed')),
    closed_at timestamptz,
    created_at timestamptz default now()
);

-- Chat messages
create table chat_messages (
    id uuid primary key default uuid_generate_v4(),
    thread_id uuid references chat_threads(id) on delete cascade,
    sender_id uuid references users(id) on delete set null,
    sender_role text not null check (sender_role in ('customer', 'admin', 'bot')),
    body text not null,
    created_at timestamptz default now()
);

-- Status history for chat (avg handle time calculation)
-- Already included in status_history table

-- Announcements
create table announcements (
    id uuid primary key default uuid_generate_v4(),
    title text not null,
    body text not null,
    images jsonb,
    expires_at timestamptz,
    created_by uuid references users(id) on delete set null,
    created_at timestamptz default now()
);

-- Notifications
create table notifications (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references users(id) on delete cascade,
    order_id uuid references orders(id) on delete set null,
    announcement_id uuid references announcements(id) on delete set null,
    type text not null check (type in ('order_status', 'chat', 'announcement', 'customer_signup')),
    title text not null,
    body text not null,
    read_at timestamptz,
    created_at timestamptz default now()
);

-- SMS settings for admin panel
create table sms_settings (
    id int primary key default 1 check (id = 1),
    provider text not null check (provider in ('static', 'twilio', 'pearl_sms')),
    otp_channel text check (otp_channel in ('static', 'sms')),
    twilio_account_sid text,
    twilio_auth_token text,
    twilio_verify_service_sid text,
    sms_gateway_url text,
    sms_gateway_key text,
    sms_sender_id text
);

-- Admin settings for acceptance page
create table accept_settings (
    id int primary key default 1 check (id = 1),
    show_prescriptions boolean default true,
    max_files int default 3,
    max_file_size_mb int default 5
);

-- Create indexes for performance
create index idx_users_phone on users(phone);
create index idx_users_role on users(role);
create index idx_users_is_active on users(is_active);
create index idx_orders_customer on orders(customer_id);
create index idx_orders_status on orders(status);
create index idx_orders_created_at on orders(created_at);
create index idx_order_items_order on order_items(order_id);
create index idx_prescriptions_order on prescriptions(order_id);
create index idx_chat_threads_customer on chat_threads(customer_id);
create index idx_chat_threads_status on chat_threads(status);
create index idx_chat_messages_thread on chat_messages(thread_id);
create index idx_notifications_user on notifications(user_id);
create index idx_notifications_created_at on notifications(created_at);
create index idx_otp_expires on otp_codes(expires_at);
create index idx_assignments_partner on assignments(partner_id);
create index idx_assignments_status on assignments(completed_at) where completed_at is null;
create index idx_attendance_partner_day on attendance(partner_id, day);
create index idx_reviews_customer on reviews(customer_id);

-- Create RLS policies (enable RLS on each table)
alter table users enable row level security;
alter table addresses enable row level security;
alter table device_tokens enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table prescriptions enable row level security;
alter table status_history enable row level security;
alter table payments enable row level security;
alter table assignments enable row level security;
alter table reviews enable row level security;
alter table review_images enable row level security;
alter table chat_threads enable row level security;
alter table chat_messages enable row level security;
alter table notifications enable row level security;
alter table announcements enable row level security;
alter table attendance enable row level security;
alter table partner_pincodes enable row level security;
alter table service_pincodes enable row level security;
alter table store_settings enable row level security;
alter table otp_codes enable row level security;
alter table account_requests enable row level security;
alter table medicines enable row level security;
alter table sms_settings enable row level security;
alter table accept_settings enable row level security;

-- RLS Policies for users
create policy "users can view their own row" on users for select using (auth.uid() = id or auth.role() = 'admin');
create policy "users can update their own row" on users for update using (auth.uid() = id);
create policy "admin can read all users" on users for select using (auth.role() = 'admin');

-- Default policies for other tables
-- These should be tuned based on your auth setup (Supabase Auth, JWT, etc.)
-- The API server uses a restricted 'kmh_api' role for direct database access