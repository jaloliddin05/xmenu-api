import { NotFoundException } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './services/organization.service';

const ID = '3f1c2a9e-5b7d-4c11-9a2e-0f6b8d4e2a10';

describe('Public organization endpoints', () => {
  const findFirst = jest.fn();
  const controller = new OrganizationController(
    new OrganizationService(
      { organization: { findFirst } } as any,
      {} as any,
      {} as any,
      {} as any,
    ),
  );
  beforeEach(() => findFirst.mockReset());

  it('return-slug: answers the slug of an active venue by its UUID', async () => {
    findFirst.mockResolvedValue({ slug: 'mant' });
    await expect(controller.getSlugById(ID)).resolves.toBe('mant');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID, is_active: true } }),
    );
  });

  it('return-slug: 404 for a numeric int_id without touching the database', async () => {
    await expect(controller.getSlugById('7')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('return-slug: 404 for an inactive or unknown venue', async () => {
    findFirst.mockResolvedValue(null);
    await expect(controller.getSlugById(ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('slug: looks up active venues only and 404s otherwise', async () => {
    findFirst.mockResolvedValue(null);
    await expect(controller.findOneBySlug('mant', 'ru')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst.mock.calls[0][0].where).toEqual({
      slug: 'mant',
      is_active: true,
    });
  });
});
