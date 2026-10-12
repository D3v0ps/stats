import Link from "next/link";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { Crumb } from "@/lib/dashboard/drill";

/** "Summa bolag › MB AB › Bemanning › Budbee Södertälje"; each crumb goes back to that level. */
export function DrillBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumb aria-label="Nedbrytning" data-testid="drill-breadcrumb">
      <BreadcrumbList className="text-sm">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {c.href ? (
                <BreadcrumbLink asChild>
                  <Link href={c.href} scroll={false} data-testid={`drill-crumb-${i}`}>
                    {c.label}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage data-testid={`drill-crumb-${i}`} className="font-medium">
                  {c.label}
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
