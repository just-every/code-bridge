import asyncio

from code_bridge.client import CodeBridgeClient, from_env


async def main():
  client = CodeBridgeClient(from_env())
  await client.start()
  await client.send_console("hello from python", level="info")
  await client.send_error("example error")
  await asyncio.sleep(0.5)
  await client.stop()


if __name__ == "__main__":
  asyncio.run(main())
