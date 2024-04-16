import { IsEnum, IsUUID } from "class-validator";
import { OrderStatus } from "@prisma/client";
import { OrderStatusList } from "./enum/order.enum";

export class ChangeOrderStatusDto {
  @IsEnum(OrderStatusList, { message: `Valid status are ${ OrderStatusList }` })
  status: OrderStatus;

  @IsUUID(4)
  id: string;
};

