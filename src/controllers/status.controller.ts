import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.client";

interface StatusParams {
  id: string;
}

export async function statusController(
  req: FastifyRequest<{ Params: StatusParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = req.params;

  const image = await prisma.image.findUnique({
    where: { id },
    select: { id: true, status: true, createdAt: true, updatedAt: true },
  });

  if (!image) {
    return reply.status(404).send({ error: `Image not found: ${id}` });
  }

  return reply.status(200).send({
    id: image.id,
    status: image.status,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  });
}
