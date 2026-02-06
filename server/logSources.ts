export type LogSource = {
  id: string;
  name: string;
  basePath: string;
  include: string[];
  exclude?: string[];
};

export const logSources: LogSource[] = [
  {
    id: "iis",
    name: "IIS Logs",
    basePath: "C:\\inetpub\\logs\\LogFiles",
    include: ["**/*.log"],
  },
  {
    id: "app",
    name: "App Logs",
    basePath: "D:\\apps\\myapp\\logs",
    include: ["**/*.log"],
  },
  {
    id: "event-export",
    name: "Windows Event Export",
    basePath: "C:\\Logs\\EventExport",
    include: ["**/*.txt"],
  },
];
