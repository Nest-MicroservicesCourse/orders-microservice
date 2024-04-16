import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangeOrderStatusDto, OrderPaginationDto } from './dto';
import { NATS_SERVICE } from 'src/config/services';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {
    super();
  }
  private readonly logger = new Logger('OrderService');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Client database online')
  }

  async create(createOrderDto: CreateOrderDto) {
    const ids = createOrderDto.items.map(item => item.productId);

    try {
      const products = await firstValueFrom(
        this.client.send({ cmd: 'validate_product' }, { ids })
      );

      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find((product) => product.id === orderItem.productId).price;
        return price * orderItem.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItm) => {
        return acc + orderItm.quantity;
      }, 0);

      // Guardar en db
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                quantity: orderItem.quantity,
                productId: orderItem.productId,
                price: products.find(product => product.id === orderItem.productId).price
              }))
            }
          }
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          }
        }
      })

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id === orderItem.productId).name
        }))
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs'
      });
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto;
    const total = await this.order.count({ where: { status } });
    const lastPage = Math.ceil(total / orderPaginationDto.limit);

    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: {
          status
        }
      }),
      meta: {
        total,
        page,
        lastPage
      }
    }
  }

  async findOne(id: string) {
    try {
      const order = await this.order.findFirst({ 
        where: { id },
        include: {
          OrderItem: {
            select: {
              quantity: true,
              price: true,
              productId: true
            }          
          }
        }
      });
      if (!order) throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`
      });
  
      const productsIds = order.OrderItem.map((orderItem) => ( orderItem.productId ));
      const products = await firstValueFrom(
        this.client.send({ cmd: 'validate_product' }, { ids: productsIds })
      )
  
      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id === orderItem.productId).name
        }))
      };
    } catch (error) {
      throw new RpcException(error);
    }
  }

  async changeOrderStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { status, id } = changeOrderStatusDto;
    const order = await this.findOne(id);

    if (order.status === status) return order;

    return await this.order.update({
      where: { id },
      data: { status }
    });

  }
}
