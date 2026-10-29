import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { Lang } from 'src/infra/http/request-helpers';
import { evaluateOpenState, formatHours, hasSchedule, OpenState } from '../domain/branch-hours';
import { BranchWithSchedule, toSchedule } from './branch-schedule.mapper';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { CreateBranchDto, SetWorkingHoursDto, UpdateBranchDto, CreateHoursExceptionDto } from '../dto/branch.dto';

const withSchedule = {
  working_hours: { orderBy: { weekday: 'asc' } },
  hours_exceptions: {
    // Faqat yaqin kunlar kerak: o'tgan istisnolar hisobga kirmaydi
    where: { date: { gte: new Date(Date.now() - 2 * 24 * 3600 * 1000) } },
  },
} as const;

/** GET /branches javobi (docs/BRANCHES_API.md). */
export interface BranchView {
  id: string;
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  hours: string;
  phone: string | null;
  isOpen: boolean;
  opensAt: string | null;
}

export function toBranchView(b: BranchWithSchedule, lang: Lang, now = new Date()): BranchView {
  const schedule = toSchedule(b);
  const state = evaluateOpenState(schedule, now);
  return {
    id: b.id,
    title: b.title,
    address: b.address,
    latitude: b.latitude,
    longitude: b.longitude,
    hours: formatHours(schedule.days, lang),
    phone: b.phone,
    isOpen: state.isOpen,
    opensAt: state.opensAt,
  };
}

@Injectable()
export class BranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidate: RevalidateService,
  ) {}

  /** Branch list, hours and open state are shown by the delivery site. */
  private async changed<T>(organizationId: string, result: T): Promise<T> {
    await this.revalidate.addRevalidationJob({ tenantId: organizationId, route: 'branches' });
    return result;
  }

  /** Mijoz uchun: faqat faol filiallar, admin belgilagan tartibda. */
  async listPublic(organizationId: string, lang: Lang): Promise<BranchView[]> {
    const rows = await this.prisma.branch.findMany({
      where: { organization_id: organizationId, is_active: true },
      include: withSchedule,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    });
    const now = new Date();
    return rows.map((b) => toBranchView(b, lang, now));
  }

  /** Buyurtma uchun: filial + hozirgi ochiq/yopiqligi (GET /branches bilan BIR XIL funksiya). */
  async findActiveWithState(organizationId: string, branchId: string) {
    const b = await this.prisma.branch.findFirst({
      where: { id: branchId, organization_id: organizationId, is_active: true },
      include: withSchedule,
    });
    if (!b) return null;
    const state: OpenState = evaluateOpenState(toSchedule(b), new Date());
    return { branch: b, state };
  }

  /** Barcha faol filiallar + ochiq/yopiqligi (buyurtma uchun filial tanlash). */
  async listActiveWithState(organizationId: string) {
    const rows = await this.prisma.branch.findMany({
      where: { organization_id: organizationId, is_active: true },
      include: withSchedule,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    });
    const now = new Date();
    return rows.map((branch) => {
      const schedule = toSchedule(branch);
      return { branch, scheduled: hasSchedule(schedule), state: evaluateOpenState(schedule, now) as OpenState };
    });
  }

  // ---------------------------------------------------------- xodimlar

  async listAdmin(organizationId: string) {
    const rows = await this.prisma.branch.findMany({
      where: { organization_id: organizationId },
      include: { working_hours: { orderBy: { weekday: 'asc' } }, hours_exceptions: { orderBy: { date: 'asc' } } },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });
    return rows;
  }

  async create(organizationId: string, dto: CreateBranchDto) {
    const branch = await this.prisma.branch.create({
      data: {
        organization_id: organizationId,
        title: dto.title,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        phone: dto.phone,
        timezone: dto.timezone,
        sort_order: dto.sortOrder,
        accepts_pickup: dto.acceptsPickup,
        accepts_delivery: dto.acceptsDelivery,
        telegram_chat_id: dto.telegramChatId,
      },
    });
    return this.changed(organizationId, branch);
  }

  async update(organizationId: string, id: string, dto: UpdateBranchDto) {
    await this.requireOwn(organizationId, id);
    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        title: dto.title,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        phone: dto.phone,
        timezone: dto.timezone,
        sort_order: dto.sortOrder,
        is_active: dto.isActive,
        accepts_pickup: dto.acceptsPickup,
        accepts_delivery: dto.acceptsDelivery,
        telegram_chat_id: dto.telegramChatId,
      },
    });
    return this.changed(organizationId, branch);
  }

  /** Haftalik jadvalni to'liq almashtiradi (PUT semantikasi). */
  async setWorkingHours(organizationId: string, id: string, dto: SetWorkingHoursDto) {
    await this.requireOwn(organizationId, id);
    await this.prisma.$transaction([
      this.prisma.branch_working_hours.deleteMany({ where: { branch_id: id } }),
      this.prisma.branch_working_hours.createMany({
        data: dto.days.map((d) => ({
          branch_id: id,
          weekday: d.weekday,
          opens_at: d.opensAt ?? '00:00',
          closes_at: d.closesAt ?? '00:00',
          is_24h: d.is24h ?? false,
          is_closed: d.isClosed ?? false,
        })),
      }),
    ]);
    return this.changed(
      organizationId,
      await this.prisma.branch_working_hours.findMany({ where: { branch_id: id }, orderBy: { weekday: 'asc' } }),
    );
  }

  async addException(organizationId: string, id: string, dto: CreateHoursExceptionDto) {
    await this.requireOwn(organizationId, id);
    const date = new Date(`${dto.date}T00:00:00Z`);
    const exception = await this.prisma.branch_hours_exception.upsert({
      where: { branch_id_date: { branch_id: id, date } },
      create: { branch_id: id, date, opens_at: dto.opensAt, closes_at: dto.closesAt, is_24h: dto.is24h ?? false, is_closed: dto.isClosed ?? false, note: dto.note },
      update: { opens_at: dto.opensAt, closes_at: dto.closesAt, is_24h: dto.is24h ?? false, is_closed: dto.isClosed ?? false, note: dto.note },
    });
    return this.changed(organizationId, exception);
  }

  async removeException(organizationId: string, id: string, exceptionId: string) {
    await this.requireOwn(organizationId, id);
    await this.prisma.branch_hours_exception.deleteMany({ where: { id: exceptionId, branch_id: id } });
    await this.changed(organizationId, undefined);
  }

  /**
   * Buyurtmasi bor filial o'chirilmaydi (buyurtmalar unga ishora qiladi) — faqat
   * yashiriladi (is_active=false). Buyurtmasiz filial to'liq o'chadi.
   */
  async remove(organizationId: string, id: string): Promise<{ deleted: boolean }> {
    await this.requireOwn(organizationId, id);
    const orders = await this.prisma.customer_order.count({ where: { branch_id: id } });
    if (orders > 0) {
      await this.prisma.branch.update({ where: { id }, data: { is_active: false } });
      return this.changed(organizationId, { deleted: false });
    }
    await this.prisma.branch.delete({ where: { id } });
    return this.changed(organizationId, { deleted: true });
  }

  private async requireOwn(organizationId: string, id: string) {
    const b = await this.prisma.branch.findFirst({ where: { id, organization_id: organizationId }, select: { id: true } });
    if (!b) throw new NotFoundException('Branch not found');
  }
}
